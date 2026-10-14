// ÁGUA — lembretes de beber água. A lista de aparelhos fica em
// data/subscription.json no GitHub (lida e gravada via API).

import { sendPush } from './push.js';

export const OWNER = 'amsa2diop';
export const REPO = 'daianalife';
export const SUB_PATH = 'data/subscription.json';
export const MESSAGES_PATH = 'data/messages.json';

function ghHeaders(env) {
  return {
    'Authorization': `Bearer ${env.GITHUB_TOKEN}`,
    'Accept': 'application/vnd.github+json',
    'User-Agent': 'daianalife-worker',
  };
}

export async function ghGetJson(path, env) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`Falha ao ler ${path}: ${res.status}`);
  const data = await res.json();
  const binary = atob(data.content.replace(/\n/g, ''));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const text = new TextDecoder('utf-8').decode(bytes);
  return { content: JSON.parse(text), sha: data.sha };
}

export async function ghPutJson(path, obj, sha, env, message) {
  const jsonText = JSON.stringify(obj, null, 2) + '\n';
  const bytes = new TextEncoder().encode(jsonText);
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: 'PUT',
    headers: ghHeaders(env),
    body: JSON.stringify({ message, content: btoa(binary), sha }),
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Falha ao gravar ${path}: ${res.status} ${body}`);
    err.status = res.status;
    throw err;
  }
}

// Lê, aplica a mudança e grava de volta; se alguém gravou no meio
// (409), tenta de novo com a versão nova.
export async function updateSubscriptionFile(env, patchFn, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { content, sha } = await ghGetJson(SUB_PATH, env);
    const merged = patchFn(normalize(content));
    try {
      await ghPutJson(SUB_PATH, merged, sha, env, message);
      return merged;
    } catch (err) {
      if (err.status === 409 && attempt < 3) continue;
      throw err;
    }
  }
}

// Aceita o formato antigo (um aparelho só) e o novo (lista).
export function normalize(content) {
  if (Array.isArray(content.subscriptions)) return content;
  if (content.subscription) {
    return {
      subscriptions: [{
        subscription: content.subscription,
        interval: content.interval ?? 60,
        nextReminder: content.nextReminder ?? null,
      }],
    };
  }
  return { subscriptions: [] };
}

// Atualiza (ou cria) a entrada de UM aparelho, identificada pelo endpoint.
// Sem inscrição e sem entrada existente não há o que atualizar: ignora em
// vez de criar uma entrada vazia (era o que acumulava entradas-fantasma).
export function upsertSubscription(content, patch) {
  const list = content.subscriptions.slice();
  const endpoint = patch.endpoint || (patch.subscription && patch.subscription.endpoint);
  if (!endpoint) throw new Error('patch sem endpoint pra identificar o aparelho');
  const idx = list.findIndex((s) => s.subscription && s.subscription.endpoint === endpoint);
  if (idx < 0 && !patch.subscription) return content;
  const base = idx >= 0 ? list[idx] : { subscription: null, interval: 60, nextReminder: null };
  const { endpoint: _drop, ...rest } = patch;
  const merged = { ...base, ...rest };
  if (idx >= 0) list[idx] = merged; else list.push(merged);
  return { ...content, subscriptions: list };
}

export async function checkAndSendAll(env, now = Date.now()) {
  const { content } = await ghGetJson(SUB_PATH, env);
  const state = normalize(content);
  if (!state.subscriptions.length) {
    console.log('Nenhum aparelho inscrito ainda.');
    return;
  }
  const { reminders } = await ghGetJson(MESSAGES_PATH, env).then((r) => r.content);

  const results = [];
  for (const entry of state.subscriptions) {
    results.push(await processOne(entry, reminders, now, env));
  }

  const messageLines = results.map((r) => r.log).filter(Boolean);
  if (!messageLines.length) return;

  await updateSubscriptionFile(env, (c) => {
    const list = normalize(c).subscriptions;
    const updatedList = list
      .map((entry) => {
        const r = results.find((r2) => r2.endpoint === (entry.subscription && entry.subscription.endpoint));
        return r ? r.updated : entry;
      })
      .filter((entry) => entry.subscription !== null);
    return { ...c, subscriptions: updatedList };
  }, 'worker: ' + messageLines.join(' | '));
}

const FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1000;
const THREE_DAYS = 3 * 24 * 60 * 60 * 1000;

// O lembrete de água INSISTE: depois que o prazo (nextReminder) vence,
// manda a cada rodada do cron até ela tocar em "Bebi um copo!" (o app é
// quem empurra o nextReminder pra frente).
export async function processOne(entry, reminders, now, env) {
  if (!entry.subscription) return { endpoint: null, updated: entry, log: null };

  const endpoint = entry.subscription.endpoint;
  const short = endpoint.slice(-8);
  const intervalMs = (entry.interval || 60) * 60000;

  // Aparelho que não abre o app há 15 dias: provavelmente trocado ou
  // abandonado. O app reinscreve sozinho se ela voltar a abrir.
  if (entry.lastSeen && now - entry.lastSeen > FIFTEEN_DAYS) {
    return { endpoint, updated: { ...entry, subscription: null }, log: `${short}: inativo ha 15+ dias, removendo` };
  }
  // Entradas antigas, sem lastSeen, não têm outro sinal de abandono:
  // atraso de 3+ dias é o único critério. Quem tem lastSeen nunca é
  // podado por atraso (foi isso que derrubava o aparelho dele: ficar
  // dias sem tocar em "Bebi um copo!" apagava a inscrição).
  if (!entry.lastSeen && entry.nextReminder && now - entry.nextReminder > THREE_DAYS) {
    return { endpoint, updated: { ...entry, subscription: null }, log: `${short}: atrasado ha 3+ dias, removendo` };
  }
  if (!entry.nextReminder) {
    return { endpoint, updated: { ...entry, nextReminder: now + intervalMs }, log: `${short}: primeiro agendamento` };
  }
  if (now < entry.nextReminder) return { endpoint, updated: entry, log: null };

  const text = reminders[Math.floor(Math.random() * reminders.length)];
  let updated = entry;
  let log;
  try {
    const status = await sendPush(env, entry.subscription, text, 3600);
    if (status === 404 || status === 410) {
      updated = { ...entry, subscription: null };
      log = 'inscricao expirada, removendo';
    } else if (status < 200 || status >= 300) {
      log = `FALHA status ${status}`;
    } else {
      log = 'enviado com sucesso';
    }
  } catch (err) {
    log = `ERRO ${String(err).slice(0, 100)}`;
  }
  return { endpoint, updated, log: `${short}: ${log}` };
}
