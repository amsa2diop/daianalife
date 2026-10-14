// Worker do DaianaLife. Três funções:
//
//  1. POST /           o app manda/atualiza a inscrição de push da ÁGUA
//                      (grava em data/subscription.json no GitHub)
//  2. POST /routines   o app manda a lista de ROTINAS (guardada no KV, privada)
//  3. GET  /cal/<segredo>.ics   calendário que o iPhone assina (webcal://)
//
// e, no Cron Trigger (a cada 20 min): manda os lembretes de água que
// venceram e os lembretes de rotinas (véspera, manhã, daqui a pouco).

import { updateSubscriptionFile, upsertSubscription, checkAndSendAll } from './water.js';
import { handleRoutinesPost, handleCalendarGet, checkRoutines } from './routines-kv.js';

const ALLOWED_ORIGIN = 'https://amsa2diop.github.io';

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGIN,
    'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (request.method === 'GET' && url.pathname.startsWith('/cal/')) {
      return handleCalendarGet(url.pathname, env);
    }

    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405, headers: corsHeaders() });
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: 'JSON inválido' }, 400);
    }

    if (url.pathname === '/routines') {
      return handleRoutinesPost(body, env, json);
    }

    // Rota original: inscrição de push da água.
    try {
      await updateSubscriptionFile(env, (content) => upsertSubscription(content, body), 'app: atualiza inscrição de um aparelho');
      return json({ ok: true });
    } catch (err) {
      return json({ ok: false, error: String(err) }, 500);
    }
  },

  // Cada parte roda isolada: se a água falhar (ex.: GitHub fora do ar),
  // as rotinas continuam, e vice-versa.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(
      Promise.allSettled([checkAndSendAll(env), checkRoutines(env)]).then((rs) => {
        rs.forEach((r, i) => {
          if (r.status === 'rejected') console.log(`${i === 0 ? 'agua' : 'rotinas'}: ERRO ${String(r.reason).slice(0, 200)}`);
        });
      })
    );
  },
};
