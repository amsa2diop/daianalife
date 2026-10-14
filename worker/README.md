# daianalife-push-relay (Cloudflare Worker)

Um Worker só, três funções:

1. **`POST /`** — recebe a inscrição de push da água e grava em
   `data/subscription.json` (GitHub).
2. **`POST /routines`** e **`GET /cal/<segredo>.ics`** — recebe as
   rotinas (KV privado) e serve o calendário que o iPhone assina.
3. **Cron Trigger** (a cada 20 min) — manda os lembretes de água que
   venceram e os das rotinas (véspera 19h, manhã 8h30, ~40 min antes).

O token do GitHub e as chaves VAPID ficam só aqui, como secrets da
Cloudflare, nunca no código público.

## Código

```
src/index.js        rotas HTTP + cron
src/water.js        lembretes de água (data/subscription.json)
src/routines.js     lógica pura das rotinas (datas, recorrência, o que está "vencido")
src/routines-kv.js  rotas e cron das rotinas (KV, privacidade, envio)
src/ics.js          gerador do calendário .ics
src/push.js         envio de um push (Web Push + VAPID)
test/               node --test (31 do Worker + 12 da interface)
dist/worker.js      resultado empacotado: é este arquivo que se cola na Cloudflare
```

```bash
cd worker
npm install
npm test          # testes
npm run build     # regera dist/worker.js
```

A biblioteca de Web Push é `@block65/webcrypto-web-push` fixada na
2.0.0 (a `web-push` do Node não roda em Workers; a 1.x quebra o
empacotamento por usar `node:crypto`).

## Instalar / atualizar

1. **KV (uma vez só)**: dash.cloudflare.com → Storage & Databases →
   **KV** → Create → nome `daianalife-routines`.
2. Worker `daianalife-push-relay` → **Settings → Bindings → Add →
   KV namespace** → variável **`ROUTINES_KV`**, namespace
   `daianalife-routines` → Save.
3. **Edit code** → apaga tudo → cola `dist/worker.js` → **Deploy**.
4. **Settings → Triggers → Cron Triggers**: `*/20 * * * *`
   (a cada 20 minutos).
5. Secrets (já existentes): `GITHUB_TOKEN`, `VAPID_PUBLIC_KEY`,
   `VAPID_PRIVATE_KEY`.

Sem o KV ligado, as rotinas respondem 503 e o app mostra o aviso de
"não consegui salvar"; a água continua funcionando normalmente.

## Privacidade das rotinas

- Ficam no KV, não no repositório.
- Chave = `sha256(segredo)`; o segredo é gerado no aparelho (256 bits)
  e é parte do endereço do calendário. O Worker nunca grava o segredo
  puro.
- `rt:<id>` (rotinas + inscrição) é escrita só pelo app; `sent:<id>`
  (o que já foi avisado) só pelo cron. Assim os dois nunca disputam a
  mesma chave.
- Logs: só contagens.

## Regras de lembrete

| Quando | Texto |
|---|---|
| Véspera, 19h | `amanhã tem <rotina> às 14h, linda` |
| Manhã, 8h30 (só se o compromisso for depois das ~10h) | `hoje tem <rotina> às 14h, linda. não esquece` |
| ~40 min antes | `<rotina> daqui a pouco, às 14h. bora, linda?` |

- Cada lembrete sai uma vez só (mapa `sent`), mesmo com o cron rodando
  várias vezes. Falha temporária: tenta de novo na rodada seguinte.
- Não avisa do que já tinha passado antes de a rotina ser criada.
- Inscrição recusada pelo serviço de push (404/410) fica marcada até o
  app mandar uma nova.

## Água

- O lembrete insiste a cada rodada do cron depois de vencido, até ela
  tocar em "Bebi um copo!" (o app empurra `nextReminder`).
- Sem janela de horário (removida).
- Aparelho sem abrir o app há 15 dias é removido da lista; o app se
  reinscreve sozinho quando ela abre (o ping diário leva a inscrição).
  Atraso de 3+ dias só remove entradas antigas **sem** `lastSeen` (era
  isso que derrubava aparelhos que ficavam dias sem tocar no botão).
- O push da água vai com TTL de 1h (o padrão da biblioteca era 60 s).
