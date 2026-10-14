import test from 'node:test';
import assert from 'node:assert/strict';

import {
  occursOn, dueReminders, sanitizeRoutine, pruneSent, nowToLocalMin, fmtTime, dayOfDateStr,
} from '../src/routines.js';
import { buildIcs, fold, escapeText } from '../src/ics.js';
import { handleRoutinesPost, handleCalendarGet, checkRoutines, deviceIdOf } from '../src/routines-kv.js';
import { processOne, upsertSubscription, normalize } from '../src/water.js';
import worker from '../src/index.js';

// ---------- utilidades ----------
const b64url = (buf) => Buffer.from(buf).toString('base64url');

// "2026-10-20 19:05" no horário do Brasil (UTC-3) -> ms UTC
const brt = (s) => Date.parse(s.replace(' ', 'T') + ':00-03:00');

class FakeKV {
  constructor() { this.m = new Map(); this.puts = []; }
  async get(k, type) { const v = this.m.get(k); return v === undefined ? null : (type === 'json' ? JSON.parse(v) : v); }
  async put(k, v) { this.m.set(k, v); this.puts.push(k); }
  async list({ prefix = '' } = {}) {
    return { keys: [...this.m.keys()].filter((k) => k.startsWith(prefix)).map((name) => ({ name })), list_complete: true };
  }
}

async function makeEnv() {
  const vapid = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign']);
  const jwk = await crypto.subtle.exportKey('jwk', vapid.privateKey);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', vapid.publicKey));
  return {
    ROUTINES_KV: new FakeKV(),
    VAPID_PUBLIC_KEY: b64url(pub),
    VAPID_PRIVATE_KEY: jwk.d,
    GITHUB_TOKEN: 'x',
  };
}

async function makeSub(host = 'push.example.com/abc') {
  const k = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
  const pub = new Uint8Array(await crypto.subtle.exportKey('raw', k.publicKey));
  return {
    endpoint: `https://${host}`,
    keys: { p256dh: b64url(pub), auth: b64url(crypto.getRandomValues(new Uint8Array(16))) },
  };
}

// intercepta fetch (pushes) e devolve a lista de chamadas
function mockFetch(handler) {
  const calls = [];
  const orig = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
  return { calls, restore: () => { globalThis.fetch = orig; } };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
const SECRET = 'a'.repeat(64);

// ---------- datas e recorrência ----------
test('occursOn: once, weekly, biweekly, monthly', () => {
  const dn = (s) => dayOfDateStr(s);
  const base = { id: 'x', title: 't', start: '2026-10-20', time: '14:00' };
  assert.ok(occursOn({ ...base, repeat: 'once' }, dn('2026-10-20')));
  assert.ok(!occursOn({ ...base, repeat: 'once' }, dn('2026-10-27')));
  assert.ok(occursOn({ ...base, repeat: 'weekly' }, dn('2026-10-27')));
  assert.ok(!occursOn({ ...base, repeat: 'weekly' }, dn('2026-10-19')), 'antes do início não vale');
  assert.ok(!occursOn({ ...base, repeat: 'biweekly' }, dn('2026-10-27')));
  assert.ok(occursOn({ ...base, repeat: 'biweekly' }, dn('2026-11-03')));
  assert.ok(occursOn({ ...base, repeat: 'monthly' }, dn('2026-12-20')));
  assert.ok(!occursOn({ ...base, repeat: 'monthly' }, dn('2026-12-21')));
});

test('dayOfDateStr rejeita datas impossíveis', () => {
  assert.equal(dayOfDateStr('2026-02-30'), null);
  assert.equal(dayOfDateStr('lixo'), null);
  assert.notEqual(dayOfDateStr('2026-02-28'), null);
});

test('fmtTime', () => {
  assert.equal(fmtTime(14 * 60), '14h');
  assert.equal(fmtTime(14 * 60 + 5), '14h05');
});

// ---------- lembretes ----------
const therapy = { id: 'r1', title: 'terapia', start: '2026-10-21', time: '14:00', repeat: 'biweekly', createdAt: brt('2026-10-01 10:00') };

test('véspera: manda às 19h do dia anterior, uma vez só', () => {
  const sent = {};
  const at = (s) => dueReminders(therapy, nowToLocalMin(brt(s)), sent);
  assert.equal(at('2026-10-20 18:50').length, 0);
  const d = at('2026-10-20 19:10');
  assert.equal(d.length, 1);
  assert.equal(d[0].kind, 'eve');
  assert.equal(d[0].text, 'amanhã tem terapia às 14h, linda');
  sent[d[0].key] = 1;
  assert.equal(at('2026-10-20 19:30').length, 0, 'não repete depois de enviado');
});

test('manhã e "daqui a pouco" no dia', () => {
  const at = (s) => dueReminders(therapy, nowToLocalMin(brt(s)), {});
  const m = at('2026-10-21 08:40');
  assert.deepEqual(m.map((x) => x.kind), ['morning']);
  assert.equal(m[0].text, 'hoje tem terapia às 14h, linda. não esquece');
  const b = at('2026-10-21 13:25');
  assert.deepEqual(b.map((x) => x.kind), ['before']);
  assert.match(b[0].text, /terapia daqui a pouco, às 14h/);
  assert.equal(at('2026-10-21 14:05').length, 0, 'depois do horário não lembra mais');
});

test('cron de 20 em 20 min: "daqui a pouco" cai entre 40 e 20 min antes', () => {
  // simula rodadas em :00, :20, :40 — exatamente uma deve disparar
  const sent = {};
  let hits = 0;
  for (const t of ['12:40', '13:00', '13:20', '13:40', '14:00']) {
    for (const d of dueReminders(therapy, nowToLocalMin(brt(`2026-10-21 ${t}`)), sent)) {
      if (d.kind === 'before') { sent[d.key] = 1; hits++; }
    }
  }
  assert.equal(hits, 1);
});

test('compromisso cedo: sem lembrete das 8h30 colado no "daqui a pouco"', () => {
  const r = { ...therapy, time: '09:00' };
  const kinds = [];
  for (const t of ['08:30', '08:40', '08:50']) {
    kinds.push(...dueReminders(r, nowToLocalMin(brt(`2026-10-21 ${t}`)), {}).map((x) => x.kind));
  }
  assert.ok(!kinds.includes('morning'));
});

test('não lembra do que já passou antes de ela criar a rotina', () => {
  // criada às 20h de véspera: o das 19h não vale, o da manhã sim
  const r = { ...therapy, createdAt: brt('2026-10-20 20:00') };
  assert.equal(dueReminders(r, nowToLocalMin(brt('2026-10-20 20:05')), {}).length, 0);
  assert.equal(dueReminders(r, nowToLocalMin(brt('2026-10-21 08:40')), {}).length, 1);
});

test('atraso do cron: véspera ainda vale até 3h depois, mas não depois disso', () => {
  assert.equal(dueReminders(therapy, nowToLocalMin(brt('2026-10-20 21:50')), {}).length, 1);
  assert.equal(dueReminders(therapy, nowToLocalMin(brt('2026-10-20 22:30')), {}).length, 0);
});

test('semanal: depois da 1ª ocorrência continua lembrando', () => {
  const r = { ...therapy, repeat: 'weekly' };
  assert.equal(dueReminders(r, nowToLocalMin(brt('2026-10-27 19:10')), {}).length, 1); // véspera de 28/10
  assert.equal(dueReminders(r, nowToLocalMin(brt('2026-10-30 19:10')), {}).length, 0);
});

test('pruneSent remove só chaves velhas', () => {
  const now = nowToLocalMin(brt('2026-10-21 10:00'));
  const today = Math.floor(now / 1440);
  const sent = { [`r|${today - 10}|840|eve`]: 1, [`r|${today}|840|eve`]: 1, __gone: 'x' };
  assert.equal(pruneSent(sent, now), true);
  assert.deepEqual(Object.keys(sent).sort(), [`r|${today}|840|eve`, '__gone'].sort());
});

test('sanitizeRoutine', () => {
  assert.equal(sanitizeRoutine({ id: 'a', title: '  ', start: '2026-10-20', time: '14:00' }), null);
  assert.equal(sanitizeRoutine({ id: 'a', title: 'x', start: '2026-10-20', time: '25:00' }), null);
  const ok = sanitizeRoutine({ id: 'a|b', title: ' terapia  ', start: '2026-10-20', time: '14:00', repeat: 'zzz' });
  assert.equal(ok.id, 'ab');
  assert.equal(ok.title, 'terapia');
  assert.equal(ok.repeat, 'once');
});

// ---------- ICS ----------
test('ICS: recorrência, horário flutuante, alarmes e CRLF', () => {
  const ics = buildIcs([therapy], brt('2026-10-14 12:00'));
  assert.ok(ics.includes('\r\nRRULE:FREQ=WEEKLY;INTERVAL=2\r\n'));
  assert.ok(ics.includes('DTSTART:20261021T140000\r\n'));
  assert.ok(ics.includes('DTEND:20261021T150000\r\n'));
  assert.ok(ics.includes('TRIGGER:-PT19H\r\n'), 'véspera 19h para evento 14h = 19h antes');
  assert.ok(ics.includes('TRIGGER:-PT5H30M\r\n'), '8h30 para evento 14h = 5h30 antes');
  assert.ok(ics.includes('TRIGGER:-PT15M\r\n'));
  assert.ok(!/[^\r]\n/.test(ics), 'só CRLF');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR') && ics.trimEnd().endsWith('END:VCALENDAR'));
});

test('ICS: evento cedo não ganha alarme das 8h30; título é escapado', () => {
  const ics = buildIcs([{ ...therapy, time: '09:00', title: 'a, b; c' }]);
  assert.ok(ics.includes('SUMMARY:a\\, b\\; c'));
  assert.equal((ics.match(/BEGIN:VALARM/g) || []).length, 2);
});

test('fold quebra linhas longas sem partir caractere multibyte', () => {
  const line = 'SUMMARY:' + 'ã'.repeat(80);
  const out = fold(line);
  for (const l of out.split('\r\n')) assert.ok(new TextEncoder().encode(l).length <= 75);
  assert.equal(out.replace(/\r\n /g, ''), line);
  assert.equal(escapeText('a\nb'), 'a\\nb');
});

// ---------- HTTP ----------
test('POST /routines grava no KV e GET /cal devolve o .ics', async () => {
  const env = await makeEnv();
  const sub = await makeSub();
  const req = new Request('https://w.example/routines', {
    method: 'POST',
    body: JSON.stringify({ secret: SECRET, routines: [therapy, { id: 'bad' }], subscription: sub }),
  });
  const res = await worker.fetch(req, env);
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, count: 1 });

  const id = await deviceIdOf(SECRET);
  assert.ok(env.ROUTINES_KV.m.has(`rt:${id}`));
  assert.ok(![...env.ROUTINES_KV.m.keys()].some((k) => k.includes(SECRET)), 'o segredo puro nunca é gravado');

  const cal = await worker.fetch(new Request(`https://w.example/cal/${SECRET}.ics`), env);
  assert.equal(cal.status, 200);
  assert.match(cal.headers.get('content-type'), /text\/calendar/);
  assert.match(await cal.text(), /SUMMARY:terapia/);

  const other = await worker.fetch(new Request(`https://w.example/cal/${'b'.repeat(64)}.ics`), env);
  assert.equal(other.status, 200);
  assert.ok(!(await other.text()).includes('terapia'), 'outro segredo não vê nada');
});

test('POST /routines valida segredo e tamanho; sem KV responde 503', async () => {
  const env = await makeEnv();
  const post = (body, e = env) => worker.fetch(new Request('https://w.example/routines', { method: 'POST', body: JSON.stringify(body) }), e);
  assert.equal((await post({ secret: 'curto', routines: [] })).status, 400);
  assert.equal((await post({ secret: SECRET, routines: 'x' })).status, 400);
  assert.equal((await post({ secret: SECRET, routines: Array(51).fill(therapy) })).status, 400);
  assert.equal((await post({ secret: SECRET, routines: [] }, {})).status, 503);
  assert.equal((await handleCalendarGet('/cal/zzz.ics', env)).status, 404);
});

test('reenviar sem inscrição mantém a inscrição anterior', async () => {
  const env = await makeEnv();
  const sub = await makeSub();
  const post = (body) => handleRoutinesPost(body, env, json);
  await post({ secret: SECRET, routines: [therapy], subscription: sub });
  await post({ secret: SECRET, routines: [therapy] });
  const rec = await env.ROUTINES_KV.get(`rt:${await deviceIdOf(SECRET)}`, 'json');
  assert.equal(rec.subscription.endpoint, sub.endpoint);
});

// ---------- cron ----------
async function seed(env, routines, sub) {
  await handleRoutinesPost({ secret: SECRET, routines, subscription: sub }, env, json);
}

test('cron manda a véspera uma única vez, mesmo rodando várias vezes', async () => {
  const env = await makeEnv();
  const sub = await makeSub();
  await seed(env, [therapy], sub);
  const f = mockFetch(() => new Response(null, { status: 201 }));
  try {
    await checkRoutines(env, brt('2026-10-20 19:05'));
    await checkRoutines(env, brt('2026-10-20 19:25'));
    await checkRoutines(env, brt('2026-10-20 19:45'));
  } finally { f.restore(); }
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].url, sub.endpoint);
  assert.equal(f.calls[0].init.headers.ttl, '7200');
});

test('cron: falha temporária tenta de novo na rodada seguinte', async () => {
  const env = await makeEnv();
  const sub = await makeSub();
  await seed(env, [therapy], sub);
  let n = 0;
  const f = mockFetch(() => new Response(null, { status: n++ === 0 ? 503 : 201 }));
  try {
    await checkRoutines(env, brt('2026-10-20 19:05'));
    await checkRoutines(env, brt('2026-10-20 19:25'));
  } finally { f.restore(); }
  assert.equal(f.calls.length, 2);
});

test('cron: 410 marca a inscrição como morta e para de insistir', async () => {
  const env = await makeEnv();
  const sub = await makeSub();
  await seed(env, [therapy], sub);
  const f = mockFetch(() => new Response(null, { status: 410 }));
  try {
    await checkRoutines(env, brt('2026-10-20 19:05'));
    await checkRoutines(env, brt('2026-10-20 19:25'));
  } finally { f.restore(); }
  assert.equal(f.calls.length, 1);
  // quando o app manda uma inscrição nova, volta a funcionar
  const sub2 = await makeSub('push.example.com/novo');
  await seed(env, [therapy], sub2);
  const f2 = mockFetch(() => new Response(null, { status: 201 }));
  try { await checkRoutines(env, brt('2026-10-20 19:45')); } finally { f2.restore(); }
  assert.equal(f2.calls.length, 1);
  assert.equal(f2.calls[0].url, sub2.endpoint);
});

test('cron: não loga títulos', async () => {
  const env = await makeEnv();
  await seed(env, [therapy], await makeSub());
  const logs = [];
  const orig = console.log;
  console.log = (...a) => logs.push(a.join(' '));
  const f = mockFetch(() => new Response(null, { status: 201 }));
  try { await checkRoutines(env, brt('2026-10-20 19:05')); } finally { f.restore(); console.log = orig; }
  assert.ok(logs.length && logs.every((l) => !l.includes('terapia')));
});

test('cron sem KV configurado não quebra', async () => {
  await checkRoutines({}, Date.now());
});

// ---------- água ----------
const waterSub = { endpoint: 'https://push.example.com/water-abcdefgh', keys: { p256dh: 'x', auth: 'y' } };

test('água: aparelho com lastSeen NÃO é podado por atraso (a causa do "parou de notificar")', async () => {
  const now = Date.now();
  const entry = { subscription: await makeSub(), interval: 60, nextReminder: now - 5 * 86400000, lastSeen: now - 86400000 };
  const env = await makeEnv();
  const f = mockFetch(() => new Response(null, { status: 201 }));
  let r;
  try { r = await processOne(entry, ['oi'], now, env); } finally { f.restore(); }
  assert.ok(r.updated.subscription, 'continua inscrito');
  assert.equal(f.calls.length, 1, 'e continua recebendo');
});

test('água: entrada antiga sem lastSeen e atrasada 3+ dias ainda é podada', async () => {
  const now = Date.now();
  const r = await processOne({ subscription: waterSub, nextReminder: now - 4 * 86400000 }, ['oi'], now, {});
  assert.equal(r.updated.subscription, null);
});

test('água: 15 dias sem abrir o app remove', async () => {
  const now = Date.now();
  const r = await processOne({ subscription: waterSub, nextReminder: now - 1000, lastSeen: now - 16 * 86400000 }, ['oi'], now, {});
  assert.equal(r.updated.subscription, null);
});

test('água: sem janela de horário — manda de madrugada também', async () => {
  const env = await makeEnv();
  const sub = await makeSub();
  const now = brt('2026-10-21 03:00');
  const f = mockFetch(() => new Response(null, { status: 201 }));
  let r;
  try { r = await processOne({ subscription: sub, interval: 60, nextReminder: now - 1000, lastSeen: now, activeFrom: 8, activeTo: 24 }, ['oi'], now, env); } finally { f.restore(); }
  assert.equal(f.calls.length, 1);
  assert.match(r.log, /enviado/);
});

test('água: antes do prazo não manda; ttl do push é 1h', async () => {
  const env = await makeEnv();
  const sub = await makeSub();
  const now = Date.now();
  const f = mockFetch(() => new Response(null, { status: 201 }));
  try {
    await processOne({ subscription: sub, nextReminder: now + 60000, lastSeen: now }, ['oi'], now, env);
    assert.equal(f.calls.length, 0);
    await processOne({ subscription: sub, nextReminder: now - 1, lastSeen: now }, ['oi'], now, env);
  } finally { f.restore(); }
  assert.equal(f.calls[0].init.headers.ttl, '3600');
});

test('água: ping de aparelho desconhecido sem inscrição não cria entrada-fantasma', () => {
  const content = normalize({ subscriptions: [] });
  assert.deepEqual(upsertSubscription(content, { endpoint: 'https://x', lastSeen: 1 }), content);
});

test('água: ping COM inscrição recria a entrada (auto-cura depois de poda)', () => {
  const content = normalize({ subscriptions: [] });
  const out = upsertSubscription(content, { subscription: waterSub, lastSeen: 5, interval: 30 });
  assert.equal(out.subscriptions.length, 1);
  assert.equal(out.subscriptions[0].lastSeen, 5);
  assert.equal(out.subscriptions[0].nextReminder, null);
});

test('água: patch por endpoint atualiza só aquele aparelho', () => {
  const content = { subscriptions: [{ subscription: waterSub, interval: 60, nextReminder: 1 }, { subscription: { endpoint: 'https://outro' }, interval: 30, nextReminder: 2 }] };
  const out = upsertSubscription(content, { endpoint: waterSub.endpoint, nextReminder: 99 });
  assert.equal(out.subscriptions[0].nextReminder, 99);
  assert.equal(out.subscriptions[1].nextReminder, 2);
});
