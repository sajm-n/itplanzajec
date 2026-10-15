// Minimalny klient Web Push (RFC 8030 + RFC 8291 aes128gcm + VAPID RFC 8292) oparty wyłącznie na wbudowanym module crypto.
// Dzięki temu workflow nie musi nic instalować (brak npm, brak zależności).
import crypto from "node:crypto";

const b64u = (buf) => Buffer.from(buf).toString("base64url");
const unb64u = (s) => Buffer.from(String(s), "base64url");

/** Nowa para kluczy VAPID: publicKey (65 B, base64url) i privateKey (32 B, base64url). */
export function generateVapidKeys() {
  const pair = crypto.generateKeyPairSync("ec", { namedCurve: "P-256" });
  const j = pair.privateKey.export({ format: "jwk" });
  const pub = Buffer.concat([Buffer.from([4]), unb64u(j.x), unb64u(j.y)]);
  return { publicKey: b64u(pub), privateKey: j.d };
}

function vapidJwt(endpoint, subject, publicKey, privateKey, now = Date.now()) {
  const pub = unb64u(publicKey);
  const key = crypto.createPrivateKey({
    key: { kty: "EC", crv: "P-256", d: privateKey, x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) },
    format: "jwk",
  });
  const aud = new URL(endpoint).origin;
  const head = b64u(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const body = b64u(JSON.stringify({ aud, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign("sha256", Buffer.from(head + "." + body), { key, dsaEncoding: "ieee-p1363" });
  return head + "." + body + "." + b64u(sig);
}

/** Szyfrowanie treści zgodnie z RFC 8291 (jeden rekord). Parametry opcjonalne służą tylko do testów z wektorem z RFC. */
export function encryptPayload(sub, plaintext, fixed = {}) {
  const uaPublic = unb64u(sub.keys.p256dh);
  const authSecret = unb64u(sub.keys.auth);
  const ecdh = crypto.createECDH("prime256v1");
  if (fixed.asPrivate) ecdh.setPrivateKey(unb64u(fixed.asPrivate));
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const secret = ecdh.computeSecret(uaPublic);
  const salt = fixed.salt ? unb64u(fixed.salt) : crypto.randomBytes(16);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(crypto.hkdfSync("sha256", secret, authSecret, keyInfo, 32));
  const cek = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(crypto.hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = crypto.createCipheriv("aes-128-gcm", cek, nonce);
  const data = Buffer.concat([Buffer.from(plaintext), Buffer.from([2])]);
  const enc = Buffer.concat([cipher.update(data), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(4096);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, enc]);
}

/**
 * Wysyła jedno powiadomienie. Zwraca {ok, status, gone}; gone=true, gdy subskrypcja wygasła (404/410) i należy ją usunąć.
 */
export async function sendPush(sub, payload, opts) {
  const { publicKey, privateKey, subject, ttl = 6 * 3600, urgency = "high" } = opts;
  const body = encryptPayload(sub, JSON.stringify(payload));
  const jwt = vapidJwt(sub.endpoint, subject, publicKey, privateKey);
  const res = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: "vapid t=" + jwt + ", k=" + publicKey,
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: String(ttl),
      Urgency: urgency,
    },
    body,
  });
  const text = res.ok ? "" : await res.text().catch(() => "");
  return { ok: res.ok, status: res.status, gone: res.status === 404 || res.status === 410, text: text.slice(0, 200) };
}

export const _test = { vapidJwt, b64u, unb64u };
