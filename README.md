# DaianaLife 💧

App web (PWA) de lembrete de água, feito pra Daiana. Deploy em
https://amsa2diop.github.io/daianalife/

Sem conta de usuário — o progresso do dia (copos, listas,
preferências) fica no `localStorage` do aparelho dela. O que sai do
aparelho: a inscrição de notificação push da água (em
`data/subscription.json`, neste repositório) e as **rotinas**
(compromissos que se repetem), que ficam num KV privado da Cloudflare,
nunca neste repositório público.

## Estrutura

```
daianalife/
├── index.html          app inteiro: markup, estilos e comportamento
├── manifest.json         metadados do PWA (nome, ícones, cor do tema)
├── sw.js                 service worker: cache offline + recebe o push
├── icons/                ícone em vários tamanhos (32 a 512px)
├── data/
│   ├── messages.json       banco de frases dos lembretes
│   └── subscription.json   inscrição de push + próximo horário
└── worker/               código-fonte do Cloudflare Worker (ver worker/README.md)
    ├── src/                código
    ├── test/               testes (`npm test`)
    └── dist/worker.js      versão pronta pra colar no painel da Cloudflare
```

## Como o push de verdade funciona

1. **App → Worker**: quando ela ativa notificação, o navegador gera
   uma inscrição de push (`PushManager`) e manda pro Cloudflare
   Worker `daianalife-push-relay`, sem nenhuma credencial no app.
2. **Worker → GitHub**: o Worker grava essa inscrição em
   `data/subscription.json` aqui no repositório, usando um token que
   só ele conhece (secret da Cloudflare).
3. **Worker, no relógio dele**: um **Cron Trigger** da própria
   Cloudflare (configurado em Settings → Triggers do Worker) roda a
   cada poucos minutos, olha esse arquivo, e se já passou do horário
   do próximo lembrete, manda a notificação via Web Push.

### Por que não é o GitHub Actions quem manda?
Foi o plano original (`push-reminder.yml`), mas o agendamento de
workflows do GitHub é "melhor esforço": na prática rodou a cada
1h30-2h em vez de a cada 15 min, o que não serve pra um lembrete.
Cron Trigger da Cloudflare é confiável de verdade, daí a mudança.

### Por que existe um Worker, se o objetivo era ficar só no GitHub?
Tentamos embutir um token do GitHub direto no `index.html` primeiro.
Não deu: **o GitHub revoga automaticamente qualquer token dele
encontrado num repositório público** (proteção de segurança deles).
Como GitHub Pages em repositório privado exige o plano Pro (pago), a
forma gratuita de guardar esse token com segurança é fora do
repositório público — daí o Worker.

### Segredos necessários
No **Cloudflare Worker** (Settings → Variables and Secrets):
- `GITHUB_TOKEN` — fine-grained, permissões **Contents: Read and
  write** + **Workflows: Read and write**, só neste repositório
- `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` — mesmo par de chaves,
  geradas uma vez

A chave pública VAPID também está hardcoded no `index.html`
(`VAPID_PUBLIC_KEY`) — sem problema ela ser pública. A privada NUNCA
deve entrar em código, só como secret.

## Rotinas (aba "rotinas")

Compromissos que se repetem (terapia quinzenal, algo semanal...). Ela
cria a rotina com nome, dia, horário e repetição; o resto é automático:

1. **Push** (camada principal): o Worker avisa na noite anterior
   (19h), de manhã (8h30) e um pouco antes (~40 min), mesmo com o app
   fechado.
2. **Calendário do iPhone**: o Worker serve um calendário (`.ics`) que
   ela assina uma vez (botão "adicionar ao Calendário", via
   `webcal://`). As rotinas novas aparecem lá sozinhas, com alertas
   de véspera, manhã e 15 min antes.
3. **Alarme do relógio do iOS**: não dá. Um app web não consegue criar
   alarmes no app Relógio. O alerta do Calendário é a alternativa.

Privacidade: as rotinas ficam no KV do Worker, numa chave derivada de
um segredo aleatório gerado no aparelho (o mesmo segredo vai no
endereço do calendário). Sem o segredo, ninguém lê nem escreve. Os
logs do Worker só têm contagens, nunca títulos.

### Limitações honestas
- Precisão de alguns minutos (intervalo do Cron Trigger escolhido, 20
  min), não é no segundo exato.
- Sem janela de silêncio: o lembrete de água insiste a cada rodada do
  cron até ela tocar em "Bebi um copo!". À noite, quem silencia é o
  Foco/Não Perturbe do próprio iPhone.
- Horários das rotinas assumem o fuso do Brasil (UTC-3, sem horário de
  verão) nos lembretes de push.
- O intervalo real do lembrete (o que ela escolhe no app) só chega
  até o Worker/GitHub quando ela muda a configuração ou toca "Bebi
  um copo!" com notificação já ativada (é nesse momento que o app
  sincroniza).

## Deploy

Já está publicado via **GitHub Pages**: Settings → Pages → branch
`main`, pasta `/ (root)`. Qualquer push pra `main` atualiza o site.

Depois de publicado, ela abre o link no Safari → ícone de compartilhar
→ "Adicionar à Tela de Início".

## Editar o conteúdo

- **Frases dos lembretes**: `data/messages.json`.
- **Cores**: variáveis no topo do `<style>` do `index.html` (`:root`).
- **Foto do ícone**: arquivos em `icons/`, todos gerados a partir da
  mesma imagem original em tamanhos diferentes. Trocar a foto do
  *ícone da Tela de Início* (fora do app) exige remover e adicionar
  de novo pelo Safari — o iOS não atualiza esse ícone sozinho.
