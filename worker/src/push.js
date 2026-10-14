import { buildPushPayload } from '@block65/webcrypto-web-push';

// Manda UM push. Devolve o status HTTP do serviço de push (Apple/Google),
// ou lança erro se nem montar a mensagem deu.
// `ttl` = por quanto tempo (s) o serviço de push segura a mensagem se o
// aparelho estiver sem rede. O padrão da biblioteca é só 60 s, o que
// derrubava lembretes quando o celular ficava offline por 1 minuto.
export async function sendPush(env, subscription, text, ttl = 3600) {
  const payload = await buildPushPayload(
    { data: JSON.stringify({ title: '', body: text }), options: { ttl } },
    subscription,
    {
      subject: 'https://amsa2diop.github.io',
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY,
    }
  );
  const res = await fetch(subscription.endpoint, payload);
  return res.status;
}
