import { sendPush } from "./push.js";

const COLECCIONES = new Set(["pesos", "sesiones", "rutinas", "fotos", "ajustes", "cardio", "notas", "ejercicios"]);
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
const USUARIO_OK = /^[a-z0-9._-]{3,20}$/;
const COOKIE = "fyb";
const UY_OFFSET_H = -3; // Uruguay no tiene horario de verano
const PBKDF2_ITER = 20000;
const enc = new TextEncoder();

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });
const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");
const espera = ms => new Promise(r => setTimeout(r, ms));

/* ---------- contraseñas y sesiones ---------- */
async function hashPassword(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g), h => parseInt(h, 16));
  const key = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: PBKDF2_ITER }, key, 256));
}
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
const sha256 = async s => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
const cookieSesion = token => `${COOKIE}=${token}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 400}`;

async function nuevaSesion(env, usuario) {
  const token = hex(crypto.getRandomValues(new Uint8Array(32)));
  await env.DB.prepare("INSERT INTO sesiones_login (token, usuario, creado) VALUES (?1, ?2, ?3)").bind(await sha256(token), usuario, Date.now()).run();
  return token;
}
async function usuarioDeSesion(req, env) {
  const m = (req.headers.get("Cookie") || "").match(/(?:^|;\s*)fyb=([a-f0-9]{64})(?:;|$)/);
  if (!m) return null;
  return await env.DB.prepare("SELECT u.usuario, u.nombre, u.admin FROM sesiones_login s JOIN usuarios u ON u.usuario = s.usuario WHERE s.token = ?1")
    .bind(await sha256(m[1])).first();
}
async function verificarPassword(env, usuario, password) {
  const u = await env.DB.prepare("SELECT usuario, hash, salt FROM usuarios WHERE usuario = ?1").bind(usuario).first();
  if (!u || typeof password !== "string") return false;
  return iguales(await hashPassword(password, u.salt), u.hash);
}
async function codigoInvitacion(env) {
  return (await env.DB.prepare("SELECT valor FROM config WHERE clave = 'invitacion'").first())?.valor || null;
}
function nuevoCodigo() {
  const letras = "abcdefghjkmnpqrstuvwxyz23456789";
  return "fierro-" + [...crypto.getRandomValues(new Uint8Array(6))].map(b => letras[b % letras.length]).join("");
}

async function api(req, env, url) {
  const p = url.pathname, method = req.method;
  const body = () => req.json().catch(() => ({}));

  if (p === "/api/vapid") return json({ publicKey: env.VAPID_PUBLIC_KEY });

  if (p === "/api/login" && method === "POST") {
    const { usuario, password } = await body();
    const u = String(usuario || "").trim().toLowerCase();
    if (!(await verificarPassword(env, u, String(password || "").trim()))) { await espera(800); return json({ error: "Usuario o contraseña incorrectos" }, 401); }
    return json({ ok: true }, 200, { "Set-Cookie": cookieSesion(await nuevaSesion(env, u)) });
  }

  if (p === "/api/registro" && method === "POST") {
    const { nombre, usuario, password, codigo } = await body();
    const u = String(usuario || "").trim().toLowerCase(), n = String(nombre || "").trim().slice(0, 40), pw = String(password || "").trim();
    const real = await codigoInvitacion(env);
    if (!real || !iguales(String(codigo || "").trim().toLowerCase(), real)) { await espera(800); return json({ error: "El código de invitación no es válido. Pedíselo a quien te invitó." }, 403); }
    if (!n) return json({ error: "Poné tu nombre." }, 400);
    if (!USUARIO_OK.test(u)) return json({ error: "El usuario tiene que tener de 3 a 20 letras minúsculas, números, punto, guion o guion bajo." }, 400);
    if (pw.length < 6) return json({ error: "La contraseña tiene que tener al menos 6 caracteres." }, 400);
    if (await env.DB.prepare("SELECT 1 FROM usuarios WHERE usuario = ?1").bind(u).first()) return json({ error: "Ese usuario ya existe. Probá con otro." }, 409);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.prepare("INSERT INTO usuarios (usuario, nombre, hash, salt, admin, creado) VALUES (?1, ?2, ?3, ?4, 0, ?5)").bind(u, n, await hashPassword(pw, salt), salt, Date.now()).run();
    return json({ ok: true }, 200, { "Set-Cookie": cookieSesion(await nuevaSesion(env, u)) });
  }

  const yo = await usuarioDeSesion(req, env);
  if (!yo) return json({ error: "Iniciá sesión" }, 401);
  const U = yo.usuario;

  if (p === "/api/me") return json({ usuario: U, nombre: yo.nombre, admin: !!yo.admin });

  if (p === "/api/logout" && method === "POST") {
    const m = (req.headers.get("Cookie") || "").match(/(?:^|;\s*)fyb=([a-f0-9]{64})/);
    if (m) await env.DB.prepare("DELETE FROM sesiones_login WHERE token = ?1").bind(await sha256(m[1])).run();
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly` });
  }

  if (p === "/api/password" && method === "POST") {
    const { actual, nueva } = await body();
    if (!(await verificarPassword(env, U, String(actual || "").trim()))) { await espera(800); return json({ error: "La contraseña actual no es correcta." }, 403); }
    const pw = String(nueva || "").trim();
    if (pw.length < 6) return json({ error: "La contraseña nueva tiene que tener al menos 6 caracteres." }, 400);
    const salt = hex(crypto.getRandomValues(new Uint8Array(16)));
    await env.DB.batch([
      env.DB.prepare("UPDATE usuarios SET hash = ?1, salt = ?2 WHERE usuario = ?3").bind(await hashPassword(pw, salt), salt, U),
      env.DB.prepare("DELETE FROM sesiones_login WHERE usuario = ?1").bind(U)
    ]);
    return json({ ok: true }, 200, { "Set-Cookie": cookieSesion(await nuevaSesion(env, U)) });
  }

  if (p === "/api/cuenta" && method === "DELETE") {
    const { password } = await body();
    if (yo.admin) return json({ error: "La cuenta administradora no se puede borrar desde la app." }, 403);
    if (!(await verificarPassword(env, U, String(password || "").trim()))) { await espera(800); return json({ error: "La contraseña no es correcta." }, 403); }
    await env.DB.batch(["registros", "fotos_blob", "suscripciones", "sesiones_login", "usuarios"].map(t => env.DB.prepare(`DELETE FROM ${t} WHERE usuario = ?1`).bind(U)));
    return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly` });
  }

  if (p === "/api/invitacion") {
    if (!yo.admin) return json({ error: "Solo la cuenta administradora puede ver el código." }, 403);
    if (method === "POST") {
      const codigo = nuevoCodigo();
      await env.DB.prepare("INSERT INTO config (clave, valor) VALUES ('invitacion', ?1) ON CONFLICT(clave) DO UPDATE SET valor = ?1").bind(codigo).run();
      return json({ codigo });
    }
    const { n } = await env.DB.prepare("SELECT COUNT(*) AS n FROM usuarios").first();
    return json({ codigo: await codigoInvitacion(env), usuarios: n });
  }

  if (p === "/api/todo" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT coleccion, id, data FROM registros WHERE usuario = ?1").bind(U).all();
    const out = { pesos: [], sesiones: [], rutinas: [], fotos: [], cardio: [], notas: [], ejercicios: [], ajustes: {} };
    for (const r of results) {
      const d = JSON.parse(r.data);
      if (r.coleccion === "ajustes") out.ajustes[r.id] = d;
      else out[r.coleccion]?.push({ id: r.id, ...d });
    }
    return json(out);
  }

  let m = p.match(/^\/api\/r\/([a-z]+)\/([^/]+)$/);
  if (m) {
    const [, col, id] = m;
    if (!COLECCIONES.has(col) || !ID_OK.test(id)) return json({ error: "Ruta inválida" }, 400);
    if (method === "PUT") {
      const txt = await req.text();
      if (txt.length > 200000) return json({ error: "Demasiado grande" }, 413);
      try { if (typeof JSON.parse(txt) !== "object") throw 0; } catch { return json({ error: "JSON inválido" }, 400); }
      await env.DB.prepare("INSERT INTO registros (usuario, coleccion, id, data, actualizado) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(usuario, coleccion, id) DO UPDATE SET data = ?4, actualizado = ?5")
        .bind(U, col, id, txt, Date.now()).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM registros WHERE usuario = ?1 AND coleccion = ?2 AND id = ?3").bind(U, col, id).run();
      return json({ ok: true });
    }
  }

  if (p === "/api/foto" && method === "POST") {
    const mime = req.headers.get("Content-Type") || "image/jpeg";
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return json({ error: "Formato no soportado" }, 415);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 1900000) return json({ error: "La foto es muy pesada" }, 413);
    const id = crypto.randomUUID().replace(/-/g, "");
    await env.DB.prepare("INSERT INTO fotos_blob (id, mime, data, creado, usuario) VALUES (?1, ?2, ?3, ?4, ?5)").bind(id, mime, buf, Date.now(), U).run();
    return json({ id, url: `/api/foto/${id}` });
  }
  m = p.match(/^\/api\/foto\/([a-f0-9]{32})$/);
  if (m) {
    if (method === "GET") {
      const row = await env.DB.prepare("SELECT mime, data FROM fotos_blob WHERE id = ?1 AND usuario = ?2").bind(m[1], U).first();
      if (!row) return new Response("No existe", { status: 404 });
      return new Response(new Uint8Array(row.data), { headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=31536000, immutable" } });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM fotos_blob WHERE id = ?1 AND usuario = ?2").bind(m[1], U).run();
      return json({ ok: true });
    }
  }

  if (p === "/api/push" && method === "POST") {
    const s = await body();
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth || !/^https:\/\//.test(s.endpoint)) return json({ error: "Suscripción inválida" }, 400);
    await env.DB.prepare("INSERT INTO suscripciones (endpoint, p256dh, auth, creado, usuario) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3, usuario = ?5")
      .bind(s.endpoint, s.keys.p256dh, s.keys.auth, Date.now(), U).run();
    return json({ ok: true });
  }
  if (p === "/api/push" && method === "DELETE") {
    const { endpoint } = await body();
    if (endpoint) await env.DB.prepare("DELETE FROM suscripciones WHERE endpoint = ?1 AND usuario = ?2").bind(endpoint, U).run();
    return json({ ok: true });
  }
  if (p === "/api/push/prueba" && method === "POST") {
    return json(await enviarA(env, U, { title: "Fierro y Balanza", body: `¡Listo, ${yo.nombre}! Las notificaciones funcionan. Te aviso todos los días a la hora que elegiste, si hay algo.` }));
  }
  if (p === "/api/avisos" && method === "GET") return json(await calcularAvisos(env, U));

  return json({ error: "No encontrado" }, 404);
}

async function enviarA(env, usuario, payload) {
  const { results } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM suscripciones WHERE usuario = ?1").bind(usuario).all();
  const cfg = { publicKey: env.VAPID_PUBLIC_KEY, privateJwk: JSON.parse(env.VAPID_PRIVATE_JWK), subject: env.VAPID_SUBJECT };
  let enviados = 0;
  for (const s of results) {
    try {
      const st = await sendPush(s, payload, cfg);
      if (st === 404 || st === 410) await env.DB.prepare("DELETE FROM suscripciones WHERE endpoint = ?1").bind(s.endpoint).run();
      else if (st >= 200 && st < 300) enviados++;
      else console.log("push status", st);
    } catch (e) { console.log("push error", e?.message); }
  }
  return { dispositivos: results.length, enviados };
}

/* ---------- avisos diarios ---------- */
const ymd = d => d.toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function calcularAvisos(env, usuario) {
  const { results } = await env.DB.prepare("SELECT coleccion, data FROM registros WHERE usuario = ?1 AND coleccion IN ('pesos','sesiones','fotos','ajustes','rutinas','cardio')").bind(usuario).all();
  const D = { pesos: [], sesiones: [], fotos: [], rutinas: [], cardio: [], cfg: {} };
  for (const r of results) {
    const d = JSON.parse(r.data);
    if (r.coleccion === "ajustes") D.cfg = d; else D[r.coleccion].push(d);
  }
  const ahora = new Date(Date.now() + UY_OFFSET_H * 3600e3); // campos UTC = hora de Uruguay
  const hoy = ymd(ahora);
  const dow = (ahora.getUTCDay() + 6) % 7; // 0 = lunes
  const lunes = ymd(new Date(ahora.getTime() - dow * 864e5));
  const meta = D.cfg.diasSemana || 3;
  const avisos = [];
  // Si el aviso es de mañana, el día de hoy todavía cuenta y los logros son los de ayer
  const temprano = (D.cfg.horaAviso ?? 21) < 15;
  const ayer = ymd(new Date(ahora.getTime() - 864e5));
  const diaLogros = temprano ? ayer : hoy;

  const dias = new Set([...D.sesiones.map(s => s.fecha), ...D.cardio.map(c => c.fecha)]);
  const estaSemana = [...dias].filter(f => f >= lunes && f <= hoy).length;
  const hoyEntreno = dias.has(hoy);

  // logros
  const prsHoy = D.sesiones.filter(s => s.fecha === diaLogros).flatMap(s => s.prs || []);
  if (prsHoy.length) avisos.push({ p: 0, t: `¡Nuevo récord en ${prsHoy.map(x => `${x.ejercicio} (${x.seg ? (x.seg >= 60 ? `${Math.floor(x.seg / 60)}:${String(x.seg % 60).padStart(2, "0")} min` : `${x.seg} s`) : `${String(x.kg).replace(".", ",")} kg`})`).join(" y ")}! ${temprano ? "Ayer" : "Hoy"} rompiste todo 🏆` });
  const total = D.sesiones.length;
  if (D.sesiones.some(s => s.fecha === diaLogros) && [1, 10, 25, 50, 100, 200].includes(total)) avisos.push({ p: 1, t: total === 1 ? "¡Primer entrenamiento registrado! Arrancaste 💪" : `¡Llegaste a ${total} entrenamientos! Ganaste una medalla nueva 🏅` });
  const pesos = [...D.pesos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  const pesoHoy = pesos.filter(p => p.fecha === diaLogros).at(-1);
  if (pesoHoy && D.cfg.pesoMeta && pesos.length > 1) {
    const ini = pesos[0].kg, metaKg = D.cfg.pesoMeta;
    if ((ini > metaKg && pesoHoy.kg <= metaKg) || (ini < metaKg && pesoHoy.kg >= metaKg)) avisos.push({ p: 0, t: `¡Llegaste a tu meta de ${String(metaKg).replace(".", ",")} kg! 🎉` });
  }

  // gimnasio y racha
  if (estaSemana < meta && total > 0) {
    const faltan = meta - estaSemana, quedan = temprano ? 7 - dow : 6 - dow; // días que quedan en la semana
    if (faltan > quedan) avisos.push({ p: 1, t: `Esta semana no llegás a los ${meta} días, pero el lunes arranca otra. ¡A no aflojar!` });
    else if (faltan === quedan) avisos.push({ p: 0, t: `Racha en riesgo: te ${faltan === 1 ? "falta 1 día" : `faltan ${faltan} días`} de gym y ${quedan === 1 ? "queda 1 día" : `quedan ${quedan} días`} esta semana.` });
    else if (temprano || !hoyEntreno) avisos.push({ p: 2, t: `Te ${faltan === 1 ? "falta 1 día" : `faltan ${faltan} días`} de gym para cumplir la semana.` });
  }

  // plan de la semana
  const diaPlan = temprano ? dow : (dow + 1) % 7, idPlan = D.cfg.plan?.[diaPlan];
  const rutinaPlan = idPlan && idPlan !== "descanso" ? D.rutinas.find(r => r.id === idPlan) : null;
  if (rutinaPlan) avisos.push({ p: 1, t: `${temprano ? "Hoy" : "Mañana"} toca ${rutinaPlan.nombre}.` });

  // peso
  const ultPeso = pesos.at(-1);
  if (ultPeso && diasEntre(ultPeso.fecha, hoy) > 7) avisos.push({ p: 2, t: `Hace ${diasEntre(ultPeso.fecha, hoy)} días que no anotás tu peso.` });

  // fotos
  const fotos = [...D.fotos].sort((a, b) => a.fecha.localeCompare(b.fecha));
  if (!fotos.length && (pesos.length || total)) avisos.push({ p: 3, t: "Todavía no tenés fotos de progreso. Sacate las primeras para comparar más adelante 📸" });
  else if (fotos.length && diasEntre(fotos.at(-1).fecha, hoy) >= 21) avisos.push({ p: 3, t: `Hace ${diasEntre(fotos.at(-1).fecha, hoy)} días que no te sacás fotos de progreso 📸` });

  avisos.sort((a, b) => a.p - b.p);
  return { hoy, horaAviso: D.cfg.horaAviso ?? 21, avisos: avisos.slice(0, 3).map(a => a.t) };
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    if (url.pathname.startsWith("/api/")) {
      try { return await api(req, env, url); }
      catch (e) { console.log("api error", e?.stack || e); return json({ error: "Error del servidor" }, 500); }
    }
    return env.ASSETS.fetch(req);
  },
  async scheduled(_ev, env, ctx) {
    ctx.waitUntil((async () => {
      // El cron corre cada hora; a cada persona se le avisa solo a la hora que eligió (por defecto 21, hora de Uruguay)
      const horaUY = new Date(Date.now() + UY_OFFSET_H * 3600e3).getUTCHours();
      const { results } = await env.DB.prepare("SELECT DISTINCT usuario FROM suscripciones").all();
      for (const { usuario } of results) {
        try {
          const { avisos, horaAviso } = await calcularAvisos(env, usuario);
          if (horaAviso !== horaUY || !avisos.length) continue;
          await enviarA(env, usuario, { title: avisos.length > 1 ? `Fierro y Balanza · ${avisos.length} avisos` : "Fierro y Balanza", body: avisos.join("\n"), url: "/" });
        } catch (e) { console.log("avisos error", usuario, e?.message); }
      }
    })());
  }
};
