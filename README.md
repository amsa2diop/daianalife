# DaianaLife 💧

App web (PWA) de lembrete de água, feito pra Daiana. Deploy em
https://amsa2diop.github.io/daianalife/

Sem conta de usuário, sem banco de dados de verdade — o progresso do
dia (copos, listas, preferências) fica no `localStorage` do aparelho
dela. A única coisa que sai do aparelho é a inscrição de notificação
push, guardada em `data/subscription.json` neste repositório.

## Estrutura

```
daianalife/
├── index.html          app inteiro: markup, estilos e comportamento
├── manifest.json         metadados do PWA (nome, ícones, cor do tema)
├── sw.js                 service worker: cache offline + recebe o push
├── icons/                ícone em vários tamanhos (32 a 512px)
└── data/
    ├── messages.json       banco de frases dos lembretes
    └── subscription.json   inscrição de push + próximo horário
```

O Cloudflare Worker que manda os lembretes de verdade vive num
projeto separado (`daianalife-worker/`, fora deste repositório) —
ver seção abaixo.

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

### Limitações honestas
- Precisão de alguns minutos (intervalo do Cron Trigger escolhido),
  não é no segundo exato.
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
