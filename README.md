# DaianaLife 💧

App web (PWA) de lembrete de água, feito pra Daiana.

Sem servidor, sem conta, sem build. É HTML/CSS/JS puro — abre o
`index.html` num navegador e já funciona. O progresso (copos, streak,
preferências) fica salvo no `localStorage` do próprio aparelho.

## Estrutura

```
daianalife-app/
├── index.html       app inteiro: markup, estilos e comportamento
├── manifest.json     metadados do PWA (nome, ícones, cor do tema)
├── sw.js              service worker, permite abrir offline depois de instalado
└── icons/             ícone em vários tamanhos (32 a 512px)
```

Todo o comentário de código explicando cada parte está direto no
`index.html`, perto do trecho que ele descreve.

## Funcionalidades

- Lembrete configurável (30 min a 2h) com contador regressivo
- Meta diária de copos, com anel de progresso ao redor da foto
- Streak de dias seguidos batendo a meta
- Notificação nativa do iOS (via Web Notifications), quando permitida
- Zerar progresso e preferências (bandeja de configurações → "zerar o app")
- Instalável na tela de início do iPhone (vira um app "de verdade", sem Xcode)

## Limitação conhecida: notificação com app fechado

O iOS suspende o JavaScript de um PWA depois que ele fica fechado por
um tempo, então o lembrete não dispara garantido com o app fechado
por horas — só quando ela reabre. Notificação 100% confiável nesse
cenário exigiria push de servidor (VAPID + backend), que esse projeto
não tem. O app explica isso pra ela dentro da própria bandeja de
notificações.

## Deploy

Qualquer host de site estático serve. Duas opções simples:

**Netlify Drop** (mais rápido, sem conta)
1. https://app.netlify.com/drop
2. Arraste a pasta `daianalife-app` inteira
3. Ele devolve uma URL tipo `https://algumnome.netlify.app`

**GitHub Pages** (mais permanente)
1. Sobe o conteúdo desta pasta pra um repositório
2. Nas configurações do repo → Pages → escolhe a branch/pasta
3. A URL fica `https://<usuario>.github.io/<repo>/`

Depois de publicado, ela abre o link no Safari → ícone de compartilhar
→ "Adicionar à Tela de Início".

## Editar o conteúdo

- **Frases dos lembretes**: arrays `MESSAGES` e `CELEBRATE`, no
  `<script>` do `index.html`.
- **Cores**: variáveis no topo do `<style>` (`:root`).
- **Foto do ícone**: arquivos em `icons/`, todos gerados a partir da
  mesma imagem original em tamanhos diferentes.
