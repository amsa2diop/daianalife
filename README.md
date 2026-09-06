# DaianaLife 💧

App web (PWA) de lembrete de água, feito pra Daiana. Deploy em
https://amsa2diop.github.io/daianalife/

Sem conta de usuário, sem banco de dados de verdade — o progresso do
dia (copos, listas, preferências) fica no `localStorage` do aparelho
dela. A única coisa que sai do aparelho é a inscrição de notificação
push, guardada em `data/subscription.json` neste repositório, pra o
GitHub Actions conseguir mandar o lembrete mesmo com o app fechado.

## Estrutura

```
daianalife/
├── index.html                       app inteiro: markup, estilos e comportamento
├── manifest.json                     metadados do PWA (nome, ícones, cor do tema)
├── sw.js                             service worker: cache offline + recebe o push
├── icons/                            ícone em vários tamanhos (32 a 512px)
├── data/
│   ├── messages.json                  banco de frases — usado pelo app E pelo Actions
│   └── subscription.json              inscrição de push + próximo horário (ver abaixo)
├── scripts/
│   └── send-push.js                   script Node que manda o push de verdade
└── .github/workflows/
    └── push-reminder.yml              roda o script acima a cada 15 min
```

Todo o comentário de código explicando cada parte está direto nos
arquivos, perto do trecho que ele descreve.

## Funcionalidades

- Lembrete configurável (30 min a 2h) com contador regressivo
- Meta diária de copos, com anel de progresso ao redor da foto
- **Notificação push de verdade**, mesmo com o app fechado (ver abaixo)
- Aba de Listas: compras e afazeres, estilo caderno, com numeração automática e apagar por arrastar
- Zerar progresso e preferências (bandeja de configurações → "zerar o app")
- Instalável na tela de início do iPhone (vira um app "de verdade", sem Xcode)

## Como o push de verdade funciona

Não tem servidor rodando 24h — quem faz esse papel é o próprio
GitHub, de duas formas:

1. **App → GitHub**: quando ela ativa notificação, o navegador gera
   uma "inscrição" de push (via `PushManager`). O app grava essa
   inscrição direto em `data/subscription.json` deste repositório,
   usando a API do GitHub — o token pra isso fica embutido no
   `index.html` (constante `GITHUB_TOKEN`), com permissão só de
   **Contents: Read and write** *neste repositório*. Esse token
   precisa continuar válido — não revogar.
2. **GitHub → ela**: o workflow `.github/workflows/push-reminder.yml`
   roda a cada 15 minutos, olha `data/subscription.json`, e se já
   passou do horário do próximo lembrete, manda a notificação via
   protocolo Web Push (biblioteca `web-push`) usando um par de chaves
   VAPID guardado como *secret* do repositório.

### Segredos necessários (Settings → Secrets and variables → Actions)
- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`

Essas chaves já foram geradas; a pública também está hardcoded no
`index.html` (`VAPID_PUBLIC_KEY`, sem problema ela ser pública). A
privada NUNCA deve entrar no código — só como secret do Actions.

### Limitações honestas
- Precisão de ±15 minutos (intervalo do cron), não é no segundo exato.
- Se o repositório ficar 60 dias sem nenhum commit, o GitHub desativa
  workflows agendados sozinho — é só abrir a aba **Actions** e reativar.
- O intervalo real do lembrete (o que ela escolhe no app) só chega até
  o GitHub quando ela muda a configuração ou toca "Bebi um copo!" com
  notificação já ativada (é nesse momento que o app sincroniza).

## Deploy

Já está publicado via **GitHub Pages**: Settings → Pages → branch
`main`, pasta `/ (root)`. Qualquer push pra `main` atualiza o site.

Pra publicar em outro lugar, qualquer host de site estático serve
(Netlify, Vercel etc.) — só o push de verdade depende de ser
especificamente este repositório GitHub (por causa do workflow).

Depois de publicado, ela abre o link no Safari → ícone de compartilhar
→ "Adicionar à Tela de Início".

## Editar o conteúdo

- **Frases dos lembretes**: `data/messages.json` — um único lugar,
  usado tanto pelo app quanto pelo script de push.
- **Cores**: variáveis no topo do `<style>` do `index.html` (`:root`).
- **Foto do ícone**: arquivos em `icons/`, todos gerados a partir da
  mesma imagem original em tamanhos diferentes.
