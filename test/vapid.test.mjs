// Comprueba que la firma VAPID (ES256) que arma src/push.js se verifica con una clave pública estándar.
import crypto from "node:crypto";
import { sendPush, b64u } from "../src/push.js";

const { publicKey, privateKey } = crypto.generateKeyPairSync("ec", { namedCurve: "prime256v1" });
const jwk = privateKey.export({ format: "jwk" });
const ua = crypto.createECDH("prime256v1"); ua.generateKeys();
let captured;
globalThis.fetch = async (url, opts) => { captured = opts; return { status: 201 }; };
await sendPush({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", p256dh: b64u.enc(ua.getPublicKey()), auth: b64u.enc(crypto.randomBytes(16)) },
  { title: "x" }, { publicKey: "k", privateJwk: jwk, subject: "https://example.com" });
const jwt = captured.headers.Authorization.match(/t=([^,]+)/)[1];
const [h, c, sig] = jwt.split(".");
const ok = crypto.verify("sha256", Buffer.from(`${h}.${c}`), { key: publicKey, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url"));
const claims = JSON.parse(Buffer.from(c, "base64url"));
if (!ok || claims.aud !== "https://fcm.googleapis.com") throw new Error("Firma o audiencia inválida");
console.log("OK, firma VAPID válida. aud:", claims.aud);
