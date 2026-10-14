// ROTINAS — parte que mexe em KV e em rede. A lógica de datas fica em
// routines.js (pura) e o calendário em ics.js.
//
// Privacidade: as rotinas (terapia etc.) NUNCA vão pro repositório
// público. Ficam no KV, numa chave derivada de um segredo aleatório que
// só existe no aparelho dela (sha256 do segredo). Quem não tem o segredo
// não consegue ler nem escrever. Os logs só trazem contagens, nunca
// títulos.
//
// Chaves no KV:
//   rt:<deviceId>    { routines, subscription, updatedAt }   escrita só pelo app
//   sent:<deviceId>  { "<chave do lembrete>": timestamp }    escrita só pelo cron
// Separadas de propósito: assim o app e o cron nunca disputam a mesma chave.

import { buildIcs } from './ics.js';
import { sendPush } from './push.js';
import { sanitizeRoutine, sanitizeSubscription, dueReminders, pruneSent, nowToLocalMin } from './routines.js';

const SECRET_RE = /^[a-f0-9]{32,128}$/;
const MAX_ROUTINES = 50;

export async function deviceIdOf(secret) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function handleRoutinesPost(body, env, json) {
  if (!env.ROUTINES_KV) {
    return json({ ok: false, error: 'KV não configurado no Worker (ROUTINES_KV)' }, 503);
  }
  const secret = body && body.secret;
  if (typeof secret !== 'string' || !SECRET_RE.test(secret)) {
    return json({ ok: false, error: 'segredo inválido' }, 400);
  }
  if (!Array.isArray(body.routines) || body.routines.length > MAX_ROUTINES) {
    return json({ ok: false, error: 'lista de rotinas inválida' }, 400);
  }
  const routines = body.routines.map(sanitizeRoutine).filter(Boolean);
  const subscription = sanitizeSubscription(body.subscription);

  const id = await deviceIdOf(secret);
  const prev = await env.ROUTINES_KV.get(`rt:${id}`, 'json');
  // Se o app não mandou a inscrição agora (ex.: sem permissão), mantém a que já tinha.
  const record = {
    routines,
    subscription: subscription || (prev && prev.subscription) || null,
    updatedAt: Date.now(),
  };
  await env.ROUTINES_KV.put(`rt:${id}`, JSON.stringify(record));
  return json({ ok: true, count: routines.length });
}

export async function handleCalendarGet(pathname, env) {
  const m = /^\/cal\/([a-f0-9]{32,128})\.ics$/.exec(pathname);
  if (!env.ROUTINES_KV || !m) return new Response('Not found', { status: 404 });
  const id = await deviceIdOf(m[1]);
  const rec = await env.ROUTINES_KV.get(`rt:${id}`, 'json');
  const ics = buildIcs((rec && rec.routines) || []);
  return new Response(ics, {
    headers: {
      'Content-Type': 'text/calendar; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Content-Disposition': 'inline; filename="daianalife.ics"',
    },
  });
}

async function listAllKeys(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor);
  return keys;
}

export async function checkRoutines(env, now = Date.now()) {
  if (!env.ROUTINES_KV) return;
  const nowMin = nowToLocalMin(now);
  const keys = await listAllKeys(env.ROUTINES_KV, 'rt:');
  let sentCount = 0;
  let failCount = 0;

  for (const key of keys) {
    const id = key.slice(3);
    const rec = await env.ROUTINES_KV.get(key, 'json');
    if (!rec || !Array.isArray(rec.routines) || !rec.routines.length) continue;

    const sent = (await env.ROUTINES_KV.get(`sent:${id}`, 'json')) || {};
    let changed = pruneSent(sent, nowMin);

    // Inscrição que o serviço de push já recusou (404/410) fica marcada
    // até o app mandar uma nova (endpoint diferente).
    const sub = rec.subscription;
    const dead = sub && sent.__gone === sub.endpoint;

    if (sub && !dead) {
      for (const r of rec.routines) {
        for (const due of dueReminders(r, nowMin, sent)) {
          try {
            const status = await sendPush(env, sub, due.text, due.ttl);
            if (status === 404 || status === 410) {
              sent.__gone = sub.endpoint;
              changed = true;
              break;
            }
            if (status >= 200 && status < 300) {
              sent[due.key] = now;
              changed = true;
              sentCount++;
            } else {
              failCount++;
            }
          } catch (err) {
            failCount++;
          }
        }
        if (sent.__gone === sub.endpoint) break;
      }
    }
    if (changed) await env.ROUTINES_KV.put(`sent:${id}`, JSON.stringify(sent));
  }
  if (sentCount || failCount) console.log(`rotinas: ${sentCount} enviados, ${failCount} falhas`);
}
