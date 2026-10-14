import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';

const HTML = readFileSync(new URL('../../index.html', import.meta.url), 'utf8');
const RELAY = 'https://daianalife-push-relay.varafd.workers.dev';

const windows = [];
after(() => { windows.forEach((w) => w.close()); });

const sleep = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// Abre o app num DOM falso. `opts.fetch(url, init)` responde às chamadas de rede.
async function boot(opts = {}) {
  const calls = [];
  const dom = new JSDOM(HTML, {
    url: 'https://amsa2diop.github.io/daianalife/index.html',
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    beforeParse(w) {
      const errors = (w.__errors = []);
      w.addEventListener('error', (e) => errors.push(e.message));
      for (const [k, v] of Object.entries(opts.storage || {})) w.localStorage.setItem(k, v);
      w.fetch = async (url, init) => {
        calls.push({ url: String(url), init, body: init && init.body ? JSON.parse(init.body) : null });
        return (opts.fetch ? opts.fetch(String(url), init) : null) || new w.Response(JSON.stringify({ ok: true }), { status: 200 });
      };
      w.Response = w.Response || Response;
      Object.defineProperty(w.navigator, 'standalone', { value: true });
      if (opts.push) {
        w.Notification = { permission: 'granted', requestPermission: async () => 'granted' };
        w.PushManager = function () {};
        const sub = { endpoint: opts.push.endpoint, keys: { p256dh: 'p', auth: 'a' } };
        Object.defineProperty(w.navigator, 'serviceWorker', {
          value: {
            ready: Promise.resolve({ pushManager: { getSubscription: async () => ({ endpoint: sub.endpoint, toJSON: () => sub }) } }),
            register: async () => ({}),
          },
        });
      }
    },
  });
  await sleep(50);
  const w = dom.window;
  windows.push(w);
  const $ = (id) => w.document.getElementById(id);
  return { dom, w, $, calls, errors: w.__errors, ls: (k) => JSON.parse(w.localStorage.getItem(k)) };
}

function fill(w, { name, date, time, repeat }) {
  const $ = (id) => w.document.getElementById(id);
  if (name !== undefined) $('routineName').value = name;
  if (date) $('routineDate').value = date;
  if (time) $('routineTime').value = time;
  if (repeat) w.document.querySelector(`#routineRepeat .chip[data-repeat="${repeat}"]`).click();
}

const tomorrow = () => { const d = new Date(); d.setDate(d.getDate() + 1); return ymd(d); };

test('carrega sem erros, sem janela de horário, com aba Rotinas', async () => {
  const a = await boot();
  assert.deepEqual(a.errors, []);
  assert.equal(a.$('activeFrom'), null);
  assert.ok(!a.w.document.body.textContent.includes('Notificar entre'));
  const tabs = [...a.w.document.querySelectorAll('.tab-btn')].map((b) => b.textContent.replace(/\s+/g, ' ').trim().replace(/^\d+ /, ''));
  assert.deepEqual(tabs, ['água', 'rotinas', 'listas']);
  a.w.document.querySelector('[data-view="viewRoutines"]').click();
  assert.ok(a.$('viewRoutines').classList.contains('active'));
  assert.match(a.$('routinesScroll').textContent, /Nada por aqui ainda/);
  assert.equal(a.calls.filter((c) => c.url.startsWith(RELAY)).length, 0, 'sem rotinas e sem histórico, não chama o servidor');
});

test('copy: "Toque em", sem "Toca em"', async () => {
  const a = await boot();
  const t = a.w.document.body.innerHTML;
  assert.ok(t.includes('Toque em <strong>'));
  assert.ok(!/Toca em/.test(t));
});

test('criar rotina: card, sincronia, calendário', async () => {
  const a = await boot();
  a.$('routineAddBtn').click();
  assert.ok(a.$('routineSheet').classList.contains('open'));
  assert.equal(a.$('routineDeleteRow').style.display, 'none');
  fill(a.w, { name: '  terapia ', date: tomorrow(), time: '14:00', repeat: 'biweekly' });
  a.$('routineSave').click();
  await sleep(50);

  assert.ok(!a.$('routineSheet').classList.contains('open'));
  const card = a.w.document.querySelector('.routine-card');
  assert.ok(card);
  assert.equal(card.querySelector('.routine-title').textContent, 'terapia');
  const tdow = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(tomorrow() + 'T12:00').getDay()];
  assert.equal(card.querySelector('.routine-meta').textContent, `${tdow} · a cada 2 semanas · 14h`);
  assert.ok(card.querySelector('.routine-date').classList.contains('soon'));
  assert.equal(card.querySelector('.routine-date .day').textContent, 'amanhã');

  const call = a.calls.find((c) => c.url === RELAY + '/routines');
  assert.ok(call, 'chamou /routines');
  assert.match(call.body.secret, /^[a-f0-9]{64}$/);
  assert.equal(call.body.routines.length, 1);
  assert.equal(call.body.routines[0].title, 'terapia');
  assert.equal(call.body.routines[0].repeat, 'biweekly');
  assert.deepEqual(call.body.routines[0].days, [new Date(tomorrow() + 'T12:00').getDay()]);
  assert.deepEqual(call.body.routines[0].remind, ['eve', 'morning', 'before']);
  assert.ok(call.body.routines[0].createdAt > 0);

  const stored = a.ls('daianalife_routines_v1');
  assert.equal(stored.items.length, 1);
  assert.equal(stored.dirty, false);

  const link = a.w.document.querySelector('a.notif-btn');
  assert.equal(link.getAttribute('href'), `webcal://daianalife-push-relay.varafd.workers.dev/cal/${call.body.secret}.ics`);
  assert.deepEqual(a.errors, []);
});

test('falha no servidor: avisa e tenta de novo ao voltar a ter internet', async () => {
  let fail = true;
  const a = await boot({ fetch: () => (fail ? new Response('x', { status: 503 }) : null) });
  a.$('routineAddBtn').click();
  fill(a.w, { name: 'yoga', date: tomorrow(), time: '07:00' });
  a.$('routineSave').click();
  await sleep(50);
  assert.equal(a.ls('daianalife_routines_v1').dirty, true);
  assert.match(a.$('routinesScroll').textContent, /Não consegui salvar/);
  assert.equal(a.w.document.querySelector('a.notif-btn'), null, 'sem link de calendário enquanto não sincronizou');

  fail = false;
  a.w.dispatchEvent(new a.w.Event('online'));
  await sleep(50);
  assert.equal(a.ls('daianalife_routines_v1').dirty, false);
  assert.doesNotMatch(a.$('routinesScroll').textContent, /Não consegui salvar/);
});

test('validações: nome vazio, data passada', async () => {
  const a = await boot();
  a.$('routineAddBtn').click();
  fill(a.w, { name: '   ', date: tomorrow(), time: '10:00' });
  a.$('routineSave').click();
  assert.match(a.$('routineHint').textContent, /nome/);
  assert.ok(a.$('routineSheet').classList.contains('open'));

  fill(a.w, { name: 'x', date: '2020-01-01', time: '10:00', repeat: 'once' });
  a.$('routineSave').click();
  assert.match(a.$('routineHint').textContent, /já passaram/);
  assert.equal(a.calls.filter((c) => c.url.startsWith(RELAY)).length, 0);
});

test('editar: só o título mantém createdAt; mudar horário renova', async () => {
  const old = Date.now() - 5 * 86400000;
  const a = await boot({
    storage: {
      daianalife_routines_v1: JSON.stringify({
        secret: 'c'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: null,
        items: [{ id: 'r1', title: 'terapia', start: tomorrow(), time: '14:00', repeat: 'weekly', createdAt: old }],
      }),
    },
  });
  a.w.document.querySelector('.routine-card').click();
  assert.equal(a.$('routineName').value, 'terapia');
  assert.equal(a.$('routineSheetTitle').textContent, 'Editar rotina');
  assert.notEqual(a.$('routineDeleteRow').style.display, 'none');

  fill(a.w, { name: 'terapia (Ana)' });
  a.$('routineSave').click();
  await sleep(50);
  assert.equal(a.ls('daianalife_routines_v1').items[0].createdAt, old);

  a.w.document.querySelector('.routine-card').click();
  fill(a.w, { time: '15:30' });
  a.$('routineSave').click();
  await sleep(50);
  const it = a.ls('daianalife_routines_v1').items[0];
  assert.ok(it.createdAt > old);
  assert.equal(it.time, '15:30');
  const dow = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][new Date(tomorrow() + 'T12:00').getDay()];
  assert.equal(a.w.document.querySelector('.routine-meta').textContent, `${dow} · toda semana · 15h30`);
});

test('apagar: confirmação em dois toques e sincroniza lista vazia', async () => {
  const a = await boot({
    storage: {
      daianalife_routines_v1: JSON.stringify({
        secret: 'd'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: null,
        items: [{ id: 'r1', title: 'terapia', start: tomorrow(), time: '14:00', repeat: 'weekly', createdAt: 1 }],
      }),
    },
  });
  a.w.document.querySelector('.routine-card').click();
  a.$('routineDelete').click();
  assert.match(a.$('routineDelete').textContent, /confirmar/);
  assert.equal(a.ls('daianalife_routines_v1').items.length, 1);
  a.$('routineDelete').click();
  await sleep(50);
  assert.equal(a.ls('daianalife_routines_v1').items.length, 0);
  const call = a.calls.find((c) => c.url === RELAY + '/routines');
  assert.deepEqual(call.body.routines, []);
  assert.match(a.$('routinesScroll').textContent, /Nada por aqui ainda/);
});

test('rotina de uma vez que passou há mais de 1 dia some sozinha', async () => {
  const a = await boot({
    storage: {
      daianalife_routines_v1: JSON.stringify({
        secret: 'e'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: null,
        items: [
          { id: 'old', title: 'velha', start: '2020-01-01', time: '10:00', repeat: 'once', createdAt: 1 },
          { id: 'rec', title: 'semanal', start: '2020-01-01', time: '10:00', repeat: 'weekly', createdAt: 1 },
        ],
      }),
    },
  });
  const titles = [...a.w.document.querySelectorAll('.routine-title')].map((n) => n.textContent);
  assert.deepEqual(titles, ['semanal']);
});

test('próxima data de recorrência quinzenal respeita a âncora', async () => {
  // âncora 2 semanas atrás -> próxima é daqui a ~0 a 14 dias, no mesmo dia da semana da âncora
  const anchor = new Date(); anchor.setDate(anchor.getDate() - 20);
  const a = await boot({
    storage: {
      daianalife_routines_v1: JSON.stringify({
        secret: 'f'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: null,
        items: [{ id: 'b', title: 'q', start: ymd(anchor), time: '23:59', repeat: 'biweekly', createdAt: 1 }],
      }),
    },
  });
  const dow = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'][anchor.getDay()];
  const label = a.w.document.querySelector('.routine-date .dow').textContent;
  assert.equal(label, dow);
});

test('sem notificações ativas mostra o aviso; com push ativo não', async () => {
  const stor = {
    daianalife_routines_v1: JSON.stringify({
      secret: 'a'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: null,
      items: [{ id: 'r', title: 't', start: tomorrow(), time: '14:00', repeat: 'weekly', createdAt: 1 }],
    }),
  };
  const off = await boot({ storage: stor });
  assert.match(off.$('routinesScroll').textContent, /Falta ativar os avisos/);

  const on = await boot({
    storage: {
      ...stor,
      daianalife_state_v1: JSON.stringify({ pushSynced: true, myEndpoint: 'https://push.example/abc', interval: 60 }),
    },
    push: { endpoint: 'https://push.example/abc' },
  });
  assert.doesNotMatch(on.$('routinesScroll').textContent, /Falta ativar os avisos/);
});

test('ping de presença leva a inscrição junto (auto-cura) e sincroniza rotinas se o endpoint mudou', async () => {
  const a = await boot({
    storage: {
      daianalife_state_v1: JSON.stringify({ pushSynced: true, myEndpoint: 'https://push.example/novo', interval: 45 }),
      daianalife_routines_v1: JSON.stringify({
        secret: 'a'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: 'https://push.example/velho',
        items: [{ id: 'r', title: 't', start: tomorrow(), time: '14:00', repeat: 'weekly', createdAt: 1 }],
      }),
    },
    push: { endpoint: 'https://push.example/novo' },
  });
  await sleep(80);
  const ping = a.calls.find((c) => c.url === RELAY && c.body && c.body.lastSeen);
  assert.ok(ping, 'mandou o ping');
  assert.equal(ping.body.subscription.endpoint, 'https://push.example/novo');
  assert.equal(ping.body.interval, 45);
  assert.equal(ping.body.activeFrom, undefined);

  const r = a.calls.find((c) => c.url === RELAY + '/routines');
  assert.ok(r, 'endpoint mudou: ressincroniza rotinas');
  assert.equal(r.body.subscription.endpoint, 'https://push.example/novo');
  assert.equal(a.ls('daianalife_routines_v1').syncedEndpoint, 'https://push.example/novo');
});

test('"zerar o app" não apaga as rotinas', async () => {
  const stor = {
    daianalife_routines_v1: JSON.stringify({
      secret: 'a'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: null,
      items: [{ id: 'r', title: 't', start: tomorrow(), time: '14:00', repeat: 'weekly', createdAt: 1 }],
    }),
  };
  const a = await boot({ storage: stor });
  a.$('resetBtn').click();
  a.$('resetBtn').click();
  assert.equal(a.ls('daianalife_routines_v1').items.length, 1);
});

// ---------- frequência, dias e momentos de aviso (interface) ----------
const q = (a, sel) => a.w.document.querySelector(sel);
const qa = (a, sel) => [...a.w.document.querySelectorAll(sel)];

test('bandeja: textos novos e opções de frequência', async () => {
  const a = await boot();
  assert.doesNotMatch(a.$('routinesScroll').textContent, /cabeça/);
  a.$('routineAddBtn').click();
  const sheet = a.$('routineSheet').textContent;
  assert.match(sheet, /Frequência/);
  assert.doesNotMatch(sheet, /Repete|só uma vez/);
  assert.deepEqual(qa(a, '#routineRepeat .chip').map((c) => c.textContent), ['não repete', 'todo dia', 'toda semana', 'a cada 2 semanas', 'todo mês']);
  assert.deepEqual(qa(a, '#routineRemind .chip').map((c) => c.textContent), ['noite anterior', 'de manhã', '2 horas antes', 'um pouco antes']);
  assert.deepEqual(qa(a, '#routineRemind .chip.active').map((c) => c.dataset.remind), ['eve', 'morning', 'before']);
});

test('dias da semana: aparecem só em toda semana / a cada 2 semanas; sempre sobra ao menos um', async () => {
  const a = await boot();
  a.$('routineAddBtn').click();
  const row = a.$('routineDays');
  assert.notEqual(row.style.display, 'none'); // padrão: toda semana
  for (const [rep, visible] of [['daily', false], ['biweekly', true], ['monthly', false], ['once', false], ['weekly', true]]) {
    q(a, `#routineRepeat .chip[data-repeat="${rep}"]`).click();
    assert.equal(row.style.display !== 'none', visible, rep);
  }
  // data = uma segunda-feira; dia marcado acompanha a data enquanto ela não mexe nos dias
  a.$('routineDate').value = '2026-10-19';
  a.$('routineDate').dispatchEvent(new a.w.Event('change'));
  assert.deepEqual(qa(a, '.day-btn.active').map((b) => b.dataset.day), ['1']);
  q(a, '.day-btn[data-day="3"]').click();
  a.$('routineDate').value = '2026-10-20';
  a.$('routineDate').dispatchEvent(new a.w.Event('change'));
  assert.deepEqual(qa(a, '.day-btn.active').map((b) => b.dataset.day), ['1', '3'], 'depois de mexer, não troca sozinho');
  q(a, '.day-btn[data-day="1"]').click();
  q(a, '.day-btn[data-day="3"]').click(); // tentaria ficar sem nenhum
  assert.deepEqual(qa(a, '.day-btn.active').map((b) => b.dataset.day), ['3']);
});

test('salvar rotina com dias escolhidos e momentos de aviso', async () => {
  const a = await boot();
  a.$('routineAddBtn').click();
  fill(a.w, { name: 'pilates', date: '2026-10-19', time: '07:30', repeat: 'weekly' });
  a.$('routineDate').dispatchEvent(new a.w.Event('change'));
  q(a, '.day-btn[data-day="3"]').click();
  q(a, '.day-btn[data-day="5"]').click();
  q(a, '#routineRemind .chip[data-remind="eve"]').click();   // desliga noite anterior
  q(a, '#routineRemind .chip[data-remind="hours"]').click(); // liga 2 horas antes
  a.$('routineSave').click();
  await sleep(50);
  const body = a.calls.find((c) => c.url === RELAY + '/routines').body.routines[0];
  assert.equal(body.repeat, 'weekly');
  assert.deepEqual(body.days, [1, 3, 5]);
  assert.deepEqual(body.remind, ['morning', 'hours', 'before']);
  assert.equal(q(a, '.routine-meta').textContent, 'seg, qua, sex · toda semana · 7h30');
});

test('todo dia: card mostra "todo dia"; sem nenhum aviso não salva', async () => {
  const a = await boot();
  a.$('routineAddBtn').click();
  fill(a.w, { name: 'remédio', date: tomorrow(), time: '08:00', repeat: 'daily' });
  for (const k of ['eve', 'morning', 'before']) q(a, `#routineRemind .chip[data-remind="${k}"]`).click();
  a.$('routineSave').click();
  assert.match(a.$('routineHint').textContent, /pelo menos um momento/);
  assert.equal(a.ls('daianalife_routines_v1').items.length, 0);
  q(a, '#routineRemind .chip[data-remind="before"]').click();
  a.$('routineSave').click();
  await sleep(50);
  assert.equal(q(a, '.routine-meta').textContent, 'todo dia · 8h');
});

test('editar mantém dias e avisos; mudar só os avisos não renova createdAt', async () => {
  const old = Date.now() - 86400000;
  const a = await boot({
    storage: {
      daianalife_routines_v1: JSON.stringify({
        secret: 'b'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: null,
        items: [{ id: 'r1', title: 'aula', start: '2026-10-19', time: '19:00', repeat: 'weekly', days: [2, 4], remind: ['hours'], createdAt: old }],
      }),
    },
  });
  q(a, '.routine-card').click();
  assert.deepEqual(qa(a, '.day-btn.active').map((b) => b.dataset.day), ['2', '4']);
  assert.deepEqual(qa(a, '#routineRemind .chip.active').map((c) => c.dataset.remind), ['hours']);
  q(a, '#routineRemind .chip[data-remind="eve"]').click();
  a.$('routineSave').click();
  await sleep(50);
  const it = a.ls('daianalife_routines_v1').items[0];
  assert.equal(it.createdAt, old);
  assert.deepEqual(it.remind, ['eve', 'hours']);
  q(a, '.routine-card').click();
  q(a, '.day-btn[data-day="2"]').click();
  a.$('routineSave').click();
  await sleep(50);
  assert.ok(a.ls('daianalife_routines_v1').items[0].createdAt > old, 'mudar os dias renova');
});

test('rotinas antigas ganham dias e avisos padrão e são reenviadas uma vez', async () => {
  const a = await boot({
    storage: {
      daianalife_routines_v1: JSON.stringify({
        secret: 'c'.repeat(64), synced: true, dirty: false, syncedEndpoint: null,
        items: [{ id: 'r1', title: 'terapia', start: '2026-10-21', time: '14:00', repeat: 'biweekly', createdAt: 1 }],
      }),
    },
  });
  await sleep(80);
  const call = a.calls.find((c) => c.url === RELAY + '/routines');
  assert.ok(call, 'reenviou');
  assert.deepEqual(call.body.routines[0].days, [3]);
  assert.deepEqual(call.body.routines[0].remind, ['eve', 'morning', 'before']);
  const st = a.ls('daianalife_routines_v1');
  assert.equal(st.schema, 2);
  assert.equal(st.dirty, false);
});

test('próxima data respeita os dias escolhidos', async () => {
  // todo dia da semana marcado = próxima ocorrência é hoje ou amanhã
  const a = await boot({
    storage: {
      daianalife_routines_v1: JSON.stringify({
        secret: 'd'.repeat(64), schema: 2, synced: true, dirty: false, syncedEndpoint: null,
        items: [{ id: 'r1', title: 'x', start: '2020-01-06', time: '23:59', repeat: 'weekly', days: [0, 1, 2, 3, 4, 5, 6], remind: ['before'], createdAt: 1 }],
      }),
    },
  });
  assert.equal(q(a, '.routine-meta').textContent, 'todo dia · 23h59');
  assert.ok(q(a, '.routine-date').classList.contains('soon'));
});
