// node_modules/uint8array-extras/index.js
var objectToString = Object.prototype.toString;
var uint8ArrayStringified = "[object Uint8Array]";
var arrayBufferStringified = "[object ArrayBuffer]";
function isType(value, typeConstructor, typeStringified) {
  if (!value) {
    return false;
  }
  if (value.constructor === typeConstructor) {
    return true;
  }
  return objectToString.call(value) === typeStringified;
}
function isUint8Array(value) {
  return isType(value, Uint8Array, uint8ArrayStringified);
}
function isArrayBuffer(value) {
  return isType(value, ArrayBuffer, arrayBufferStringified);
}
function isUint8ArrayOrArrayBuffer(value) {
  return isUint8Array(value) || isArrayBuffer(value);
}
function toUint8ArrayIfArrayBuffer(value) {
  return isArrayBuffer(value) ? new Uint8Array(value) : value;
}
function assertUint8ArrayOrArrayBuffer(value) {
  if (!isUint8ArrayOrArrayBuffer(value)) {
    throw new TypeError(`Expected \`Uint8Array\` or \`ArrayBuffer\`, got \`${typeof value}\``);
  }
}
function toUint8Array(value) {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  throw new TypeError(`Unsupported value, got \`${typeof value}\`.`);
}
function concatUint8Arrays(arrays, totalLength) {
  if (arrays.length === 0) {
    return new Uint8Array(0);
  }
  totalLength ??= arrays.reduce((accumulator, currentValue) => accumulator + currentValue.byteLength, 0);
  const returnValue = new Uint8Array(totalLength);
  let offset = 0;
  for (let array of arrays) {
    assertUint8ArrayOrArrayBuffer(array);
    array = toUint8ArrayIfArrayBuffer(array);
    returnValue.set(array, offset);
    offset += array.length;
  }
  return returnValue;
}
var cachedDecoders = {
  utf8: new globalThis.TextDecoder("utf8")
};
function assertString(value) {
  if (typeof value !== "string") {
    throw new TypeError(`Expected \`string\`, got \`${typeof value}\``);
  }
}
var cachedEncoder = new globalThis.TextEncoder();
function stringToUint8Array(string) {
  assertString(string);
  return cachedEncoder.encode(string);
}
function base64ToBase64Url(base64) {
  return base64.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}
function base64UrlToBase64(base64url) {
  const base64 = base64url.replaceAll("-", "+").replaceAll("_", "/");
  const padding = (4 - base64.length % 4) % 4;
  return base64 + "=".repeat(padding);
}
var MAX_BLOCK_SIZE = 65535;
function uint8ArrayToBase64(array, { urlSafe = false } = {}) {
  assertUint8ArrayOrArrayBuffer(array);
  array = toUint8ArrayIfArrayBuffer(array);
  let base64 = "";
  for (let index = 0; index < array.length; index += MAX_BLOCK_SIZE) {
    const chunk = array.subarray(index, index + MAX_BLOCK_SIZE);
    base64 += globalThis.btoa(String.fromCodePoint.apply(void 0, chunk));
  }
  return urlSafe ? base64ToBase64Url(base64) : base64;
}
function base64ToUint8Array(base64String) {
  assertString(base64String);
  return Uint8Array.from(globalThis.atob(base64UrlToBase64(base64String)), (x) => x.codePointAt(0));
}
var byteToHexLookupTable = Array.from({ length: 256 }, (_, index) => index.toString(16).padStart(2, "0"));

// node_modules/@block65/webcrypto-web-push/dist/lib/utils.js
function encodeRecordSize(size) {
  const bytes = new Uint8Array(4);
  new DataView(bytes.buffer).setUint32(0, size);
  return bytes;
}
function invariant(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// node_modules/@block65/webcrypto-web-push/dist/lib/client-keys.js
async function deriveClientKeys(sub) {
  const bytes = base64ToUint8Array(sub.keys.p256dh);
  const authSecretBytes = base64ToUint8Array(sub.keys.auth);
  invariant(bytes.byteLength === 65 && bytes[0] === 4, "Subscription p256dh is not an uncompressed P-256 point");
  invariant(authSecretBytes.byteLength === 16, "Subscription auth secret is not 16 bytes");
  return {
    publicKeyBytes: bytes,
    publicKey: await crypto.subtle.importKey("raw", bytes, {
      name: "ECDH",
      namedCurve: "P-256"
    }, false, []),
    authSecretBytes
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/hkdf.js
function createHMAC(data) {
  const keyPromise = crypto.subtle.importKey("raw", data, {
    name: "HMAC",
    hash: "SHA-256"
  }, false, ["sign"]);
  return {
    hash: async (input) => {
      const k = await keyPromise;
      return crypto.subtle.sign("HMAC", k, input);
    }
  };
}
async function hkdf(salt, ikm) {
  const prkhPromise = createHMAC(salt).hash(ikm).then((prk) => createHMAC(prk));
  return {
    extract: async (info, len) => {
      const prkh = await prkhPromise;
      const blocks = await Array.from({ length: Math.ceil(len / 32) }, (_, i) => i).reduce(async (acc, i) => {
        const previous = await acc;
        const hash = await prkh.hash(new Uint8Array([...previous.at(-1) ?? [], ...info, i + 1]));
        return [...previous, new Uint8Array(hash)];
      }, Promise.resolve([]));
      return concatUint8Arrays(blocks).slice(0, len);
    }
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/info.js
function createKeyInfo(clientPublic, serverPublic) {
  return new Uint8Array([
    ...stringToUint8Array("WebPush: info\0"),
    ...clientPublic,
    ...serverPublic
  ]);
}
function createInfo(type) {
  return stringToUint8Array(`Content-Encoding: ${type}\0`);
}

// node_modules/@block65/webcrypto-web-push/dist/lib/local-keys.js
async function generateLocalKeys() {
  const keyPair = await crypto.subtle.generateKey({
    name: "ECDH",
    namedCurve: "P-256"
  }, false, ["deriveBits"]);
  return {
    privateKey: keyPair.privateKey,
    publicKeyBytes: new Uint8Array(await crypto.subtle.exportKey("raw", keyPair.publicKey))
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/salt.js
async function getSalt() {
  return crypto.getRandomValues(new Uint8Array(16));
}

// node_modules/@block65/webcrypto-web-push/dist/lib/encrypt.js
var recordSize = 4096;
var headerSize = 21 + 65;
var maxPlaintextSize = recordSize - headerSize - 17;
async function encryptNotification(subscription, plaintext, options = {}) {
  invariant(plaintext.byteLength <= maxPlaintextSize, `Payload is ${plaintext.byteLength} bytes, the maximum is ${maxPlaintextSize}`);
  const clientKeys = await deriveClientKeys(subscription);
  const salt = await getSalt();
  const localKeys = await generateLocalKeys();
  const sharedSecret = await crypto.subtle.deriveBits({
    name: "ECDH",
    public: clientKeys.publicKey
  }, localKeys.privateKey, 256);
  const keyInfo = createKeyInfo(clientKeys.publicKeyBytes, localKeys.publicKeyBytes);
  const cekInfo = createInfo("aes128gcm");
  const nonceInfo = createInfo("nonce");
  const ikmHkdf = await hkdf(clientKeys.authSecretBytes, sharedSecret);
  const ikm = await ikmHkdf.extract(keyInfo, 32);
  const messageHkdf = await hkdf(salt, ikm);
  const cekBytes = await messageHkdf.extract(cekInfo, 16);
  const nonceBytes = await messageHkdf.extract(nonceInfo, 12);
  const cekCryptoKey = await crypto.subtle.importKey("raw", cekBytes, {
    name: "AES-GCM",
    length: 128
  }, false, ["encrypt"]);
  const padTo = options.pad ?? true ? maxPlaintextSize : plaintext.byteLength;
  const padded = new Uint8Array(padTo + 1);
  padded.set(plaintext);
  padded[plaintext.byteLength] = 2;
  const encrypted = await crypto.subtle.encrypt({
    name: "AES-GCM",
    iv: nonceBytes
  }, cekCryptoKey, padded);
  return new Uint8Array([
    ...salt,
    ...encodeRecordSize(recordSize),
    localKeys.publicKeyBytes.byteLength,
    ...localKeys.publicKeyBytes,
    ...new Uint8Array(encrypted)
  ]);
}

// node_modules/@block65/webcrypto-web-push/dist/lib/base64.js
function encodeBase64Url(value) {
  return uint8ArrayToBase64(toUint8Array(value), { urlSafe: true });
}
function objectToBase64Url(obj) {
  return encodeBase64Url(stringToUint8Array(JSON.stringify(obj)));
}

// node_modules/@block65/webcrypto-web-push/dist/lib/jwt.js
async function sign(payload, key) {
  const headerStr = objectToBase64Url({
    typ: "JWT",
    alg: "ES256"
  });
  const payloadStr = objectToBase64Url({
    iat: Math.floor(Date.now() / 1e3),
    ...payload
  });
  const dataStr = `${headerStr}.${payloadStr}`;
  const signature = await crypto.subtle.sign({
    name: "ECDSA",
    hash: "SHA-256"
  }, key, stringToUint8Array(dataStr));
  return `${dataStr}.${encodeBase64Url(signature)}`;
}

// node_modules/@block65/webcrypto-web-push/dist/lib/vapid.js
async function vapidHeaders(subscription, vapid) {
  invariant(vapid.subject, "Vapid subject is empty");
  invariant(vapid.privateKey, "Vapid private key is empty");
  invariant(vapid.publicKey, "Vapid public key is empty");
  const endpoint = new URL(subscription.endpoint);
  invariant(endpoint.protocol === "https:", `Subscription endpoint is not https: ${endpoint.protocol}`);
  const vapidPublicKeyBytes = base64ToUint8Array(vapid.publicKey);
  const publicKey = await crypto.subtle.importKey("jwk", {
    kty: "EC",
    crv: "P-256",
    x: encodeBase64Url(vapidPublicKeyBytes.slice(1, 33)),
    y: encodeBase64Url(vapidPublicKeyBytes.slice(33, 65)),
    d: vapid.privateKey
  }, {
    name: "ECDSA",
    namedCurve: "P-256"
  }, false, ["sign"]);
  const jwt = await sign({
    aud: endpoint.origin,
    exp: Math.floor(Date.now() / 1e3) + 12 * 60 * 60,
    sub: vapid.subject
  }, publicKey);
  return {
    headers: {
      authorization: `vapid t=${jwt}, k=${vapid.publicKey}`
    }
  };
}

// node_modules/@block65/webcrypto-web-push/dist/lib/payload.js
async function buildPushPayload(message, subscription, vapid) {
  const { headers } = await vapidHeaders(subscription, vapid);
  const body = await encryptNotification(subscription, stringToUint8Array(
    // if its a primitive, convert to string, otherwise stringify
    typeof message.data === "string" || typeof message.data === "number" ? message.data.toString() : JSON.stringify(message.data)
  ));
  return {
    headers: {
      ...headers,
      ttl: (message.options?.ttl || 60).toString(),
      ...message.options?.urgency && {
        urgency: message.options.urgency
      },
      ...message.options?.topic && {
        topic: message.options.topic
      },
      "content-encoding": "aes128gcm",
      "content-length": body.byteLength.toString(),
      "content-type": "application/octet-stream"
    },
    method: "post",
    body
  };
}

// src/push.js
async function sendPush(env, subscription, text, ttl = 3600) {
  const payload = await buildPushPayload(
    { data: JSON.stringify({ title: "", body: text }), options: { ttl } },
    subscription,
    {
      subject: "https://amsa2diop.github.io",
      publicKey: env.VAPID_PUBLIC_KEY,
      privateKey: env.VAPID_PRIVATE_KEY
    }
  );
  const res = await fetch(subscription.endpoint, payload);
  return res.status;
}

// src/water.js
var OWNER = "amsa2diop";
var REPO = "daianalife";
var SUB_PATH = "data/subscription.json";
var MESSAGES_PATH = "data/messages.json";
function ghHeaders(env) {
  return {
    "Authorization": `Bearer ${env.GITHUB_TOKEN}`,
    "Accept": "application/vnd.github+json",
    "User-Agent": "daianalife-worker"
  };
}
async function ghGetJson(path, env) {
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, { headers: ghHeaders(env) });
  if (!res.ok) throw new Error(`Falha ao ler ${path}: ${res.status}`);
  const data = await res.json();
  const binary = atob(data.content.replace(/\n/g, ""));
  const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
  const text = new TextDecoder("utf-8").decode(bytes);
  return { content: JSON.parse(text), sha: data.sha };
}
async function ghPutJson(path, obj, sha, env, message) {
  const jsonText = JSON.stringify(obj, null, 2) + "\n";
  const bytes = new TextEncoder().encode(jsonText);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  const res = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${path}`, {
    method: "PUT",
    headers: ghHeaders(env),
    body: JSON.stringify({ message, content: btoa(binary), sha })
  });
  if (!res.ok) {
    const body = await res.text();
    const err = new Error(`Falha ao gravar ${path}: ${res.status} ${body}`);
    err.status = res.status;
    throw err;
  }
}
async function updateSubscriptionFile(env, patchFn, message) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const { content, sha } = await ghGetJson(SUB_PATH, env);
    const merged = patchFn(normalize(content));
    try {
      await ghPutJson(SUB_PATH, merged, sha, env, message);
      return merged;
    } catch (err) {
      if (err.status === 409 && attempt < 3) continue;
      throw err;
    }
  }
}
function normalize(content) {
  if (Array.isArray(content.subscriptions)) return content;
  if (content.subscription) {
    return {
      subscriptions: [{
        subscription: content.subscription,
        interval: content.interval ?? 60,
        nextReminder: content.nextReminder ?? null
      }]
    };
  }
  return { subscriptions: [] };
}
function upsertSubscription(content, patch) {
  const list = content.subscriptions.slice();
  const endpoint = patch.endpoint || patch.subscription && patch.subscription.endpoint;
  if (!endpoint) throw new Error("patch sem endpoint pra identificar o aparelho");
  const idx = list.findIndex((s) => s.subscription && s.subscription.endpoint === endpoint);
  if (idx < 0 && !patch.subscription) return content;
  const base = idx >= 0 ? list[idx] : { subscription: null, interval: 60, nextReminder: null };
  const { endpoint: _drop, ...rest } = patch;
  const merged = { ...base, ...rest };
  if (idx >= 0) list[idx] = merged;
  else list.push(merged);
  return { ...content, subscriptions: list };
}
async function checkAndSendAll(env, now = Date.now()) {
  const { content } = await ghGetJson(SUB_PATH, env);
  const state = normalize(content);
  if (!state.subscriptions.length) {
    console.log("Nenhum aparelho inscrito ainda.");
    return;
  }
  const { reminders } = await ghGetJson(MESSAGES_PATH, env).then((r) => r.content);
  const results = [];
  for (const entry of state.subscriptions) {
    results.push(await processOne(entry, reminders, now, env));
  }
  const messageLines = results.map((r) => r.log).filter(Boolean);
  if (!messageLines.length) return;
  await updateSubscriptionFile(env, (c) => {
    const list = normalize(c).subscriptions;
    const updatedList = list.map((entry) => {
      const r = results.find((r2) => r2.endpoint === (entry.subscription && entry.subscription.endpoint));
      return r ? r.updated : entry;
    }).filter((entry) => entry.subscription !== null);
    return { ...c, subscriptions: updatedList };
  }, "worker: " + messageLines.join(" | "));
}
var FIFTEEN_DAYS = 15 * 24 * 60 * 60 * 1e3;
var THREE_DAYS = 3 * 24 * 60 * 60 * 1e3;
async function processOne(entry, reminders, now, env) {
  if (!entry.subscription) return { endpoint: null, updated: entry, log: null };
  const endpoint = entry.subscription.endpoint;
  const short = endpoint.slice(-8);
  const intervalMs = (entry.interval || 60) * 6e4;
  if (entry.lastSeen && now - entry.lastSeen > FIFTEEN_DAYS) {
    return { endpoint, updated: { ...entry, subscription: null }, log: `${short}: inativo ha 15+ dias, removendo` };
  }
  if (!entry.lastSeen && entry.nextReminder && now - entry.nextReminder > THREE_DAYS) {
    return { endpoint, updated: { ...entry, subscription: null }, log: `${short}: atrasado ha 3+ dias, removendo` };
  }
  if (!entry.nextReminder) {
    return { endpoint, updated: { ...entry, nextReminder: now + intervalMs }, log: `${short}: primeiro agendamento` };
  }
  if (now < entry.nextReminder) return { endpoint, updated: entry, log: null };
  const text = reminders[Math.floor(Math.random() * reminders.length)];
  let updated = entry;
  let log;
  try {
    const status = await sendPush(env, entry.subscription, text, 3600);
    if (status === 404 || status === 410) {
      updated = { ...entry, subscription: null };
      log = "inscricao expirada, removendo";
    } else if (status < 200 || status >= 300) {
      log = `FALHA status ${status}`;
    } else {
      log = "enviado com sucesso";
    }
  } catch (err) {
    log = `ERRO ${String(err).slice(0, 100)}`;
  }
  return { endpoint, updated, log: `${short}: ${log}` };
}

// src/routines.js
var TZ_OFFSET_MIN = -180;
var EVE_AT = 19 * 60;
var MORNING_AT = 8 * 60 + 30;
var HOURS_BEFORE_MIN = 120;
var BEFORE_MIN = 40;
var ALARM_BEFORE_MIN = 15;
var LATE_GRACE_MIN = 180;
var REPEATS = ["once", "daily", "weekly", "biweekly", "monthly"];
var REMIND_KINDS = ["eve", "morning", "hours", "before"];
var DEFAULT_REMIND = ["eve", "morning", "before"];
var DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
var TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
function nowToLocalMin(nowMs) {
  return Math.floor(nowMs / 6e4) + TZ_OFFSET_MIN;
}
function dayOfDateStr(s) {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const y = +m[1], mo = +m[2], d = +m[3];
  const ms = Date.UTC(y, mo - 1, d);
  const chk = new Date(ms);
  if (chk.getUTCFullYear() !== y || chk.getUTCMonth() !== mo - 1 || chk.getUTCDate() !== d) return null;
  return Math.floor(ms / 864e5);
}
function minOfTimeStr(s) {
  const m = TIME_RE.exec(s);
  return m ? +m[1] * 60 + +m[2] : null;
}
function dowOfDn(dn) {
  return new Date(dn * 864e5).getUTCDay();
}
function sanitizeRoutine(r) {
  if (!r || typeof r !== "object") return null;
  const id = String(r.id || "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 40);
  if (!id) return null;
  const title = String(r.title || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!title) return null;
  const startDn = dayOfDateStr(r.start);
  if (startDn === null) return null;
  if (minOfTimeStr(r.time) === null) return null;
  const repeat = REPEATS.includes(r.repeat) ? r.repeat : "once";
  const createdAt = Number.isFinite(r.createdAt) ? r.createdAt : 0;
  let days = Array.isArray(r.days) ? [...new Set(r.days.filter((d) => Number.isInteger(d) && d >= 0 && d <= 6))].sort() : [];
  if (!days.length) days = [dowOfDn(startDn)];
  const remind = Array.isArray(r.remind) ? REMIND_KINDS.filter((k) => r.remind.includes(k)) : DEFAULT_REMIND.slice();
  return { id, title, start: r.start, time: r.time, repeat, days, remind, createdAt };
}
function sanitizeSubscription(s) {
  if (!s || typeof s !== "object") return null;
  if (typeof s.endpoint !== "string" || !s.endpoint.startsWith("https://")) return null;
  const keys = s.keys;
  if (!keys || typeof keys.p256dh !== "string" || typeof keys.auth !== "string") return null;
  return { endpoint: s.endpoint, keys: { p256dh: keys.p256dh, auth: keys.auth } };
}
function occursOn(r, dn) {
  const startDn = dayOfDateStr(r.start);
  if (startDn === null || dn < startDn) return false;
  const diff = dn - startDn;
  const days = Array.isArray(r.days) && r.days.length ? r.days : [dowOfDn(startDn)];
  switch (r.repeat) {
    case "daily":
      return true;
    case "weekly":
      return days.includes(dowOfDn(dn));
    case "biweekly": {
      const weekIdx = Math.floor((dn - (startDn - dowOfDn(startDn))) / 7);
      return weekIdx % 2 === 0 && days.includes(dowOfDn(dn));
    }
    case "monthly":
      return new Date(dn * 864e5).getUTCDate() === new Date(startDn * 864e5).getUTCDate();
    default:
      return diff === 0;
  }
}
function fmtTime(tm) {
  const h = Math.floor(tm / 60), m = tm % 60;
  return m ? `${h}h${String(m).padStart(2, "0")}` : `${h}h`;
}
function textFor(kind, title, tm) {
  const t = fmtTime(tm);
  if (kind === "eve") return `amanh\xE3 tem ${title} \xE0s ${t}, linda`;
  if (kind === "morning") return `hoje tem ${title} \xE0s ${t}, linda. n\xE3o esquece`;
  if (kind === "hours") return `daqui a umas 2 horas tem ${title}, \xE0s ${t}, linda`;
  return `${title} daqui a pouco, \xE0s ${t}. bora, linda?`;
}
function dueReminders(r, nowMin, sent) {
  const out = [];
  const tm = minOfTimeStr(r.time);
  const createdMin = r.createdAt ? nowToLocalMin(r.createdAt) : -Infinity;
  const today = Math.floor(nowMin / 1440);
  for (let dn = today - 1; dn <= today + 2; dn++) {
    if (!occursOn(r, dn)) continue;
    const S = dn * 1440 + tm;
    if (nowMin >= S) continue;
    const want = (k) => (Array.isArray(r.remind) ? r.remind : DEFAULT_REMIND).includes(k);
    const morningT = dn * 1440 + MORNING_AT;
    const morningOk = S - morningT >= 120;
    const hoursT = S - HOURS_BEFORE_MIN;
    const targets = [];
    if (want("eve")) targets.push(["eve", (dn - 1) * 1440 + EVE_AT, LATE_GRACE_MIN]);
    if (want("morning") && morningOk) targets.push(["morning", morningT, LATE_GRACE_MIN]);
    if (want("hours") && !(want("morning") && morningOk && Math.abs(hoursT - morningT) < 60)) {
      targets.push(["hours", hoursT, BEFORE_MIN]);
    }
    if (want("before")) targets.push(["before", S - BEFORE_MIN, BEFORE_MIN]);
    for (const [kind, T, grace] of targets) {
      if (T < createdMin) continue;
      if (nowMin < T || nowMin >= T + grace) continue;
      if (nowMin >= S) continue;
      const key = `${r.id}|${dn}|${tm}|${kind}`;
      if (sent[key]) continue;
      out.push({ key, kind, text: textFor(kind, r.title, tm), ttl: kind === "before" ? 1800 : kind === "hours" ? 3600 : 7200 });
    }
  }
  return out;
}
function pruneSent(sent, nowMin) {
  const today = Math.floor(nowMin / 1440);
  let changed = false;
  for (const k of Object.keys(sent)) {
    if (k.startsWith("__")) continue;
    const dn = Number(k.split("|")[1]);
    if (!Number.isFinite(dn) || dn < today - 3) {
      delete sent[k];
      changed = true;
    }
  }
  return changed;
}

// src/ics.js
var pad = (n, w = 2) => String(n).padStart(w, "0");
function floating(min) {
  const d = new Date(min * 6e4);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}00`;
}
function utcStamp(ms) {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}
function escapeText(s) {
  return String(s).replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
function fold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let cur = "";
  let curBytes = 0;
  let limit = 75;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (curBytes + b > limit) {
      parts.push(cur);
      cur = "";
      curBytes = 0;
      limit = 74;
    }
    cur += ch;
    curBytes += b;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
function negDuration(totalMin) {
  const d = Math.floor(totalMin / 1440);
  const h = Math.floor(totalMin % 1440 / 60);
  const m = totalMin % 60;
  let s = "-P";
  if (d) s += `${d}D`;
  if (h || m || !d) {
    s += "T";
    if (h) s += `${h}H`;
    if (m || !h) s += `${m}M`;
  }
  return s;
}
function alarm(minutesBefore, description) {
  return [
    "BEGIN:VALARM",
    "ACTION:DISPLAY",
    `DESCRIPTION:${escapeText(description)}`,
    `TRIGGER:${negDuration(minutesBefore)}`,
    "END:VALARM"
  ];
}
var BYDAY = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];
function rruleFor(r) {
  const dayList = Array.isArray(r.days) && r.days.length ? r.days : [dowOfDn(dayOfDateStr(r.start))];
  const days = dayList.map((d) => BYDAY[d]).join(",");
  switch (r.repeat) {
    case "daily":
      return "FREQ=DAILY";
    case "weekly":
      return `FREQ=WEEKLY;BYDAY=${days}`;
    case "biweekly":
      return `FREQ=WEEKLY;INTERVAL=2;BYDAY=${days};WKST=SU`;
    case "monthly":
      return "FREQ=MONTHLY";
    default:
      return null;
  }
}
function firstOccurrenceDn(r, startDn) {
  for (let i = 0; i < 800; i++) {
    if (occursOn(r, startDn + i)) return startDn + i;
  }
  return startDn;
}
function buildIcs(routines, nowMs = Date.now()) {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DaianaLife//Rotinas//PT",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "X-WR-CALNAME:DaianaLife",
    "REFRESH-INTERVAL;VALUE=DURATION:PT1H",
    "X-PUBLISHED-TTL:PT1H"
  ];
  const stamp = utcStamp(nowMs);
  for (const r of routines) {
    const dn = dayOfDateStr(r.start);
    const tm = minOfTimeStr(r.time);
    if (dn === null || tm === null) continue;
    const S = firstOccurrenceDn(r, dn) * 1440 + tm;
    const remind = Array.isArray(r.remind) ? r.remind : DEFAULT_REMIND;
    lines.push("BEGIN:VEVENT");
    lines.push(`UID:${r.id}@daianalife`);
    lines.push(`DTSTAMP:${stamp}`);
    lines.push(`DTSTART:${floating(S)}`);
    lines.push(`DTEND:${floating(S + 60)}`);
    lines.push(`SUMMARY:${escapeText(r.title)}`);
    const rrule = rruleFor(r);
    if (rrule) lines.push(`RRULE:${rrule}`);
    if (remind.includes("eve")) lines.push(...alarm(1440 - EVE_AT + tm, `amanh\xE3: ${r.title}`));
    if (remind.includes("morning") && tm - MORNING_AT >= 120) lines.push(...alarm(tm - MORNING_AT, `hoje: ${r.title}`));
    if (remind.includes("hours")) lines.push(...alarm(HOURS_BEFORE_MIN, `daqui a umas 2 horas: ${r.title}`));
    if (remind.includes("before")) lines.push(...alarm(ALARM_BEFORE_MIN, `daqui a pouco: ${r.title}`));
    lines.push("END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

// src/routines-kv.js
var SECRET_RE = /^[a-f0-9]{32,128}$/;
var MAX_ROUTINES = 50;
async function deviceIdOf(secret) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
async function handleRoutinesPost(body, env, json2) {
  if (!env.ROUTINES_KV) {
    return json2({ ok: false, error: "KV n\xE3o configurado no Worker (ROUTINES_KV)" }, 503);
  }
  const secret = body && body.secret;
  if (typeof secret !== "string" || !SECRET_RE.test(secret)) {
    return json2({ ok: false, error: "segredo inv\xE1lido" }, 400);
  }
  if (!Array.isArray(body.routines) || body.routines.length > MAX_ROUTINES) {
    return json2({ ok: false, error: "lista de rotinas inv\xE1lida" }, 400);
  }
  const routines = body.routines.map(sanitizeRoutine).filter(Boolean);
  const subscription = sanitizeSubscription(body.subscription);
  const id = await deviceIdOf(secret);
  const prev = await env.ROUTINES_KV.get(`rt:${id}`, "json");
  const record = {
    routines,
    subscription: subscription || prev && prev.subscription || null,
    updatedAt: Date.now()
  };
  await env.ROUTINES_KV.put(`rt:${id}`, JSON.stringify(record));
  return json2({ ok: true, count: routines.length });
}
async function handleCalendarGet(pathname, env) {
  const m = /^\/cal\/([a-f0-9]{32,128})\.ics$/.exec(pathname);
  if (!env.ROUTINES_KV || !m) return new Response("Not found", { status: 404 });
  const id = await deviceIdOf(m[1]);
  const rec = await env.ROUTINES_KV.get(`rt:${id}`, "json");
  const ics = buildIcs(rec && rec.routines || []);
  return new Response(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Cache-Control": "no-cache",
      "Content-Disposition": 'inline; filename="daianalife.ics"'
    }
  });
}
async function listAllKeys(kv, prefix) {
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix, cursor });
    keys.push(...page.keys.map((k) => k.name));
    cursor = page.list_complete ? void 0 : page.cursor;
  } while (cursor);
  return keys;
}
async function checkRoutines(env, now = Date.now()) {
  if (!env.ROUTINES_KV) return;
  const nowMin = nowToLocalMin(now);
  const keys = await listAllKeys(env.ROUTINES_KV, "rt:");
  let sentCount = 0;
  let failCount = 0;
  for (const key of keys) {
    const id = key.slice(3);
    const rec = await env.ROUTINES_KV.get(key, "json");
    if (!rec || !Array.isArray(rec.routines) || !rec.routines.length) continue;
    const sent = await env.ROUTINES_KV.get(`sent:${id}`, "json") || {};
    let changed = pruneSent(sent, nowMin);
    const sub = rec.subscription;
    const dead = sub && sent.__gone === sub.endpoint;
    if (sub && !dead) {
      for (const r of rec.routines) {
        for (const due of dueReminders(r, nowMin, sent)) {
          try {
            const status = await sendPush(env, sub, due.text, due.ttl);
            if (status === 404 || status === 410) {
              sent.__gone = sub.endpoint;
              changed = true;
              break;
            }
            if (status >= 200 && status < 300) {
              sent[due.key] = now;
              changed = true;
              sentCount++;
            } else {
              failCount++;
            }
          } catch (err) {
            failCount++;
          }
        }
        if (sent.__gone === sub.endpoint) break;
      }
    }
    if (changed) await env.ROUTINES_KV.put(`sent:${id}`, JSON.stringify(sent));
  }
  if (sentCount || failCount) console.log(`rotinas: ${sentCount} enviados, ${failCount} falhas`);
}

// src/index.js
var ALLOWED_ORIGIN = "https://amsa2diop.github.io";
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  };
}
function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(), "Content-Type": "application/json" }
  });
}
var index_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders() });
    }
    if (request.method === "GET" && url.pathname.startsWith("/cal/")) {
      return handleCalendarGet(url.pathname, env);
    }
    if (request.method !== "POST") {
      return new Response("Method not allowed", { status: 405, headers: corsHeaders() });
    }
    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ ok: false, error: "JSON inv\xE1lido" }, 400);
    }
    if (url.pathname === "/routines") {
      return handleRoutinesPost(body, env, json);
    }
    try {
      await updateSubscriptionFile(env, (content) => upsertSubscription(content, body), "app: atualiza inscri\xE7\xE3o de um aparelho");
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
          if (r.status === "rejected") console.log(`${i === 0 ? "agua" : "rotinas"}: ERRO ${String(r.reason).slice(0, 200)}`);
        });
      })
    );
  }
};
export {
  index_default as default
};
