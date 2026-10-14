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
export const HOURS_BEFORE_MIN = 120;   // "horas antes": ~2h antes
export const BEFORE_MIN = 40;          // "daqui a pouco": ~40 min antes (o cron roda a cada 20 min, então chega entre 40 e 20 min antes)
export const ALARM_BEFORE_MIN = 15;    // alerta do calendário, 15 min antes

// Quanto tempo depois do horário-alvo ainda vale mandar (se o cron atrasar).
const LATE_GRACE_MIN = 180;

export const REPEATS = ['once', 'daily', 'weekly', 'biweekly', 'monthly'];
// Momentos de aviso que ela pode ligar/desligar em cada rotina.
// 'before' = "um pouco antes" (nome mantido por compatibilidade).
export const REMIND_KINDS = ['eve', 'morning', 'hours', 'before'];
export const DEFAULT_REMIND = ['eve', 'morning', 'before'];

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

export function dowOfDn(dn) {
  return new Date(dn * 86400000).getUTCDay();
}

export function sanitizeRoutine(r) {
  if (!r || typeof r !== 'object') return null;
  const id = String(r.id || '').replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 40);
  if (!id) return null;
  const title = String(r.title || '').replace(/\s+/g, ' ').trim().slice(0, 80);
  if (!title) return null;
  const startDn = dayOfDateStr(r.start);
  if (startDn === null) return null;
  if (minOfTimeStr(r.time) === null) return null;
  const repeat = REPEATS.includes(r.repeat) ? r.repeat : 'once';
  const createdAt = Number.isFinite(r.createdAt) ? r.createdAt : 0;

  // dias da semana (0 = domingo): só contam em semanal e quinzenal;
  // sem dias válidos, vale o dia da semana da data de início
  let days = Array.isArray(r.days) ? [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (!days.length) days = [dowOfDn(startDn)];

  const remind = Array.isArray(r.remind)
    ? REMIND_KINDS.filter((k) => r.remind.includes(k))
    : DEFAULT_REMIND.slice();

  return { id, title, start: r.start, time: r.time, repeat, days, remind, createdAt };
}

export function sanitizeSubscription(s) {
  if (!s || typeof s !== 'object') return null;
  if (typeof s.endpoint !== 'string' || !s.endpoint.startsWith('https://')) return null;
  const keys = s.keys;
  if (!keys || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') return null;
  return { endpoint: s.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}

// A rotina cai no dia `dn` (número do dia local)?
// Semanas contam de domingo a sábado; "a cada 2 semanas" conta a partir
// da semana da data de início (mesma regra do calendário .ics).
export function occursOn(r, dn) {
  const startDn = dayOfDateStr(r.start);
  if (startDn === null || dn < startDn) return false;
  const diff = dn - startDn;
  const days = Array.isArray(r.days) && r.days.length ? r.days : [dowOfDn(startDn)];
  switch (r.repeat) {
    case 'daily': return true;
    case 'weekly': return days.includes(dowOfDn(dn));
    case 'biweekly': {
      const weekIdx = Math.floor((dn - (startDn - dowOfDn(startDn))) / 7);
      return weekIdx % 2 === 0 && days.includes(dowOfDn(dn));
    }
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
  if (kind === 'hours') return `daqui a umas 2 horas tem ${title}, às ${t}, linda`;
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

    const want = (k) => (Array.isArray(r.remind) ? r.remind : DEFAULT_REMIND).includes(k);
    const morningT = dn * 1440 + MORNING_AT;
    // se o compromisso é cedo (antes das ~10h30), o aviso das 8h30 ficaria colado nos de "horas antes"/"um pouco antes"
    const morningOk = S - morningT >= 120;
    const hoursT = S - HOURS_BEFORE_MIN;

    const targets = [];
    if (want('eve')) targets.push(['eve', (dn - 1) * 1440 + EVE_AT, LATE_GRACE_MIN]);
    if (want('morning') && morningOk) targets.push(['morning', morningT, LATE_GRACE_MIN]);
    // "horas antes" não vale se cair a menos de 1h do aviso da manhã (seriam dois avisos quase juntos)
    if (want('hours') && !(want('morning') && morningOk && Math.abs(hoursT - morningT) < 60)) {
      targets.push(['hours', hoursT, BEFORE_MIN]);
    }
    if (want('before')) targets.push(['before', S - BEFORE_MIN, BEFORE_MIN]);

    for (const [kind, T, grace] of targets) {
      if (T < createdMin) continue;               // não lembra do que passou antes de ela criar
      if (nowMin < T || nowMin >= T + grace) continue;
      if (nowMin >= S) continue;
      const key = `${r.id}|${dn}|${tm}|${kind}`;
      if (sent[key]) continue;
      out.push({ key, kind, text: textFor(kind, r.title, tm), ttl: kind === 'before' ? 1800 : kind === 'hours' ? 3600 : 7200 });
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
