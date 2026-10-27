// Cifra con src/push.js y descifra con http_ece (la referencia que usa web-push) para comprobar compatibilidad.
import ece from "http_ece";
import crypto from "node:crypto";
import { encryptPayload, b64u } from "../src/push.js";

const ua = crypto.createECDH("prime256v1");
ua.generateKeys();
const auth = crypto.randomBytes(16);
const msg = JSON.stringify({ title: "Fierro y Balanza", body: "Te faltan 2 días esta semana 💪" });

const body = await encryptPayload(msg, b64u.enc(ua.getPublicKey()), b64u.enc(auth));
const out = ece.decrypt(Buffer.from(body), { version: "aes128gcm", privateKey: ua, authSecret: auth });
if (out.toString() !== msg) throw new Error("No coincide: " + out.toString());
console.log("OK, descifrado:", out.toString());
