// Gera o calendário (.ics) que o iPhone assina via webcal://.
//
// Horários "flutuantes" (sem fuso, sem "Z"): o Calendário interpreta no
// fuso do aparelho, então "14:00" é 14h onde ela estiver.
// Cada evento leva 3 alertas relativos ao início (a mesma ideia dos
// lembretes de push: véspera, manhã e "daqui a pouco").

import { dayOfDateStr, minOfTimeStr, occursOn, dowOfDn, EVE_AT, MORNING_AT, HOURS_BEFORE_MIN, ALARM_BEFORE_MIN, DEFAULT_REMIND } from './routines.js';

const pad = (n, w = 2) => String(n).padStart(w, '0');

// minutos locais desde 1970 -> 20261020T140000
function floating(min) {
  const d = new Date(min * 60000);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}

function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

export function escapeText(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// Linhas do iCalendar não podem passar de 75 bytes; o excedente vai na
// linha seguinte, começando com um espaço.
export function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = '';
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = '';
      curBytes = 0;
      limit = 74; // o espaço inicial das continuações ocupa 1
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join('\r\n ');
}

// "-PT15M", "-PT5H40M", "-P1DT2H"
function negDuration(totalMin) {
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor((totalMin % 1440) / 60);
  const m = totalMin % 60;
  let s = '-P';
  if (d) s += `${d}D`;
  if (h || m || !d) {
    s += 'T';
    if (h) s += `${h}H`;
    if (m || !h) s += `${m}M`;
  }
  return s;
}

function alarm(minutesBefore, description) {
  return [
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${escapeText(description)}`,
    `TRIGGER:${negDuration(minutesBefore)}`,
    'END:VALARM',
  ];
}

const BYDAY = ['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA'];

function rruleFor(r) {
  const dayList = Array.isArray(r.days) && r.days.length ? r.days : [dowOfDn(dayOfDateStr(r.start))];
  const days = dayList.map((d) => BYDAY[d]).join(',');
  switch (r.repeat) {
    case 'daily': return 'FREQ=DAILY';
    case 'weekly': return `FREQ=WEEKLY;BYDAY=${days}`;
    case 'biweekly': return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${days};WKST=SU`;
    case 'monthly': return 'FREQ=MONTHLY';
    default: return null;
  }
}

// O primeiro dia em que a rotina realmente acontece (pode ser depois da
// data de início, se ela não cair num dos dias escolhidos). O calendário
// exige que DTSTART seja uma ocorrência válida da regra.
function firstOccurrenceDn(r, startDn) {
  for (let i = 0; i < 800; i++) {
    if (occursOn(r, startDn + i)) return startDn + i;
  }
  return startDn;
}

export function buildIcs(routines, nowMs = Date.now()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DaianaLife//Rotinas//PT',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'X-WR-CALNAME:DaianaLife',
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H',
  ];
  const stamp = utcStamp(nowMs);

  for (const r of routines) {
    const dn = dayOfDateStr(r.start);
    const tm = minOfTimeStr(r.time);
    if (dn === null || tm === null) continue;
    const S = firstOccurrenceDn(r, dn) * 1440 + tm;
    const remind = Array.isArray(r.remind) ? r.remind : DEFAULT_REMIND;

    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${r.id}@daianalife`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${floating(S)}`);
    lines.push(`DTEND:${floating(S + 60)}`);
    lines.push(`SUMMARY:${escapeText(r.title)}`);
    const rrule = rruleFor(r);
    if (rrule) lines.push(`RRULE:${rrule}`);
    if (remind.includes('eve')) lines.push(...alarm((1440 - EVE_AT) + tm, `amanhã: ${r.title}`));                    // véspera, 19h
    if (remind.includes('morning') && tm - MORNING_AT >= 120) lines.push(...alarm(tm - MORNING_AT, `hoje: ${r.title}`)); // manhã, 8h30
    if (remind.includes('hours')) lines.push(...alarm(HOURS_BEFORE_MIN, `daqui a umas 2 horas: ${r.title}`));
    if (remind.includes('before')) lines.push(...alarm(ALARM_BEFORE_MIN, `daqui a pouco: ${r.title}`));
    lines.push('END:VEVENT');
  }

  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
