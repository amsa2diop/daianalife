// Rodado pelo workflow .github/workflows/push-reminder.yml a cada 15
// minutos. Lê data/subscription.json (inscrição de push + intervalo
// escolhido no app + horário do próximo lembrete) e data/messages.json
// (mesmo banco de frases que o app usa). Se já passou do horário,
// manda a notificação e agenda o próximo horário.
const fs = require('fs');
const path = require('path');
const webpush = require('web-push');

const SUB_PATH = path.join(__dirname, '..', 'data', 'subscription.json');
const MESSAGES_PATH = path.join(__dirname, '..', 'data', 'messages.json');

const state = JSON.parse(fs.readFileSync(SUB_PATH, 'utf8'));
const { reminders } = JSON.parse(fs.readFileSync(MESSAGES_PATH, 'utf8'));

function save(){
  fs.writeFileSync(SUB_PATH, JSON.stringify(state, null, 2) + '\n');
}

async function main(){
  if(!state.subscription){
    console.log('Sem inscrição salva ainda — nada a fazer.');
    return;
  }

  const intervalMs = (state.interval || 60) * 60000;
  const now = Date.now();

  if(!state.nextReminder){
    state.nextReminder = now + intervalMs;
    save();
    console.log('Primeiro agendamento definido, sem envio agora.');
    return;
  }

  if(now < state.nextReminder){
    console.log('Ainda não é hora. Faltam', Math.round((state.nextReminder - now) / 60000), 'min.');
    return;
  }

  webpush.setVapidDetails(
    'mailto:amsa@daianalife.local',
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );

  const text = reminders[Math.floor(Math.random() * reminders.length)];
  const payload = JSON.stringify({ title: '💧', body: text });

  try {
    await webpush.sendNotification(state.subscription, payload);
    console.log('Lembrete enviado:', text);
  } catch (err) {
    // 404/410 = a inscrição não existe mais no navegador dela (ex: app
    // reinstalado). Limpa pra parar de tentar até ela ativar de novo.
    if(err.statusCode === 404 || err.statusCode === 410){
      console.log('Inscrição expirada, limpando.');
      state.subscription = null;
    } else {
      console.error('Falha ao enviar push:', err.statusCode, err.body || err.message);
    }
  }

  state.nextReminder = now + intervalMs;
  save();
}

main();
