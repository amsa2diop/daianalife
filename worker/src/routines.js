// ROTINAS — lógica pura (sem rede, sem KV), fácil de testar.
//
// Todo horário aqui é "horário de parede" do Brasil (UTC-3, sem horário
// de verão). Em vez de lidar com fusos, tudo vira MINUTOS inteiros desde
// 1970 já deslocados pra UTC-3: dia = floor(min / 1440), minuto do dia =
// min % 1440. Assim "amanhã às 14h" é só aritmética de inteiros.

export const TZ_OFFSET_MIN = -180;

// Quando cada lembrete de push dispara (minuto do dia, horário local).
export const EVE_AT = 19 * 60;         // véspera, 19h
export const MORNING_AT = 8 * 60 + 30; // de manhã, 8h30
export const BEFORE_MIN = 40;          // "daqui a pouco": ~40 min antes (o cron roda a cada 20 min, então chega entre 40 e 20 min antes)
export const ALARM_BEFORE_MIN = 15;    // alerta do calendário, 15 min antes

// Quanto tempo depois do horário-alvo ainda vale mandar (se o cron atrasar).
const LATE_GRACE_MIN = 180;

export const REPEATS = ['once', 'weekly', 'biweekly', 'monthly'];

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function nowToLocalMin(nowMs) {
  return Math.floor(nowMs / 60000) + TZ_OFFSET_MIN;
}

export function dayOfDateStr(s) {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const ms = Date.UTC(y, mo - 1, d);
  const chk = new Date(ms);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return Math.floor(ms / 86400000);
}

export function minOfTimeStr(s) {
  const m = TIME_RE.exec(s);
  return m ? +m[1] * 60 + +m[2] : null;
}

export function sanitizeRoutine(r) {
  if (!r || typeof r !== 'object') return null;
  const id = String(r.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (!id) return null;
  const title = String(r.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!title) return null;
  if (dayOfDateStr(r.start) === null) return null;
  if (minOfTimeStr(r.time) === null) return null;
  const repeat = REPEATS.includes(r.repeat) ? r.repeat : 'once';
  const createdAt = Number.isFinite(r.createdAt) ? r.createdAt : 0;
  return { id, title, start: r.start, time: r.time, repeat, createdAt };
}

export function sanitizeSubscription(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://')) return null;
  const keys = s.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  return { endpoint: s.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

// A rotina cai no dia `dn` (número do dia local)?
export function occursOn(r, dn) {
  const startDn = dayOfDateStr(r.start);
  if (startDn === null || dn < startDn) return false;
  const diff = dn - startDn;
  switch (r.repeat) {
    case 'weekly': return diff % 7 === 0;
    case 'biweekly': return diff % 14 === 0;
    case 'monthly':
      return new Date(dn * 86400000).getUTCDate() === new Date(startDn * 86400000).getUTCDate();
    default: return diff === 0;
  }
}

export function fmtTime(tm) {
  const h = Math.floor(tm / 60), m = tm % 60;
  return m ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
}

function textFor(kind, title, tm) {
  const t = fmtTime(tm);
  if (kind === 'eve') return `amanhã tem ${title} às ${t}, linda`;
  if (kind === 'morning') return `hoje tem ${title} às ${t}, linda. não esquece`;
  return `${title} daqui a pouco, às ${t}. bora, linda?`;
}

// Quais lembretes de push desta rotina já "venceram" e ainda não foram
// mandados? `sent` é o mapa chave -> timestamp de envio.
// Devolve [{ key, kind, text, ttl }].
export function dueReminders(r, nowMin, sent) {
  const out = [];
  const tm = minOfTimeStr(r.time);
  const createdMin = r.createdAt ? nowToLocalMin(r.createdAt) : -Infinity;
  const today = Math.floor(nowMin / 1440);

  for (let dn = today - 1; dn <= today + 2; dn++) {
    if (!occursOn(r, dn)) continue;
    const S = dn * 1440 + tm;
    if (nowMin >= S) continue; // já começou, não adianta lembrar

    const targets = [
      ['eve', (dn - 1) * 1440 + EVE_AT, LATE_GRACE_MIN],
      // se o compromisso é cedo (antes das ~10h), o lembrete das 8h30 ficaria colado no de "daqui a pouco"
      ...(S - (dn * 1440 + MORNING_AT) >= 90 ? [['morning', dn * 1440 + MORNING_AT, LATE_GRACE_MIN]] : []),
      ['before', S - BEFORE_MIN, BEFORE_MIN],
    ];

    for (const [kind, T, grace] of targets) {
      if (T < createdMin) continue;               // não lembra do que passou antes de ela criar
      if (nowMin < T || nowMin >= T + grace) continue;
      if (nowMin >= S) continue;
      const key = `${r.id}|${dn}|${tm}|${kind}`;
      if (sent[key]) continue;
      out.push({ key, kind, text: textFor(kind, r.title, tm), ttl: kind === 'before' ? 1800 : 7200 });
    }
  }
  return out;
}

// Tira do mapa `sent` o que é velho demais pra importar (dia da
// ocorrência mais de 3 dias atrás). Devolve true se mudou algo.
export function pruneSent(sent, nowMin) {
  const today = Math.floor(nowMin / 1440);
  let changed = false;
  for (const k of Object.keys(sent)) {
    if (k.startsWith('__')) continue;
    const dn = Number(k.split('|')[1]);
    if (!Number.isFinite(dn) || dn < today - 3) { delete sent[k]; changed = true; }
  }
  return changed;
}
