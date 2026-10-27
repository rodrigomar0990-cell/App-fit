import { sendPush } from "./push.js";

const COLECCIONES = new Set(["pesos", "sesiones", "rutinas", "fotos", "ajustes", "cardio", "notas", "ejercicios"]);
const ID_OK = /^[A-Za-z0-9_-]{1,64}$/;
const COOKIE = "fyb";
const UY_OFFSET_H = -3; // Uruguay no tiene horario de verano

const json = (data, status = 200, extra = {}) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra } });

async function tokenSesion(env) {
  const k = await crypto.subtle.importKey("raw", new TextEncoder().encode(env.APP_PASSWORD), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", k, new TextEncoder().encode("fyb-sesion-v1"));
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, "0")).join("");
}
function iguales(a, b) {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
async function autenticado(req, env) {
  const m = (req.headers.get("Cookie") || "").match(/(?:^|;\s*)fyb=([a-f0-9]+)/);
  return !!m && iguales(m[1], await tokenSesion(env));
}

async function api(req, env, url) {
  const p = url.pathname, method = req.method;

  if (p === "/api/login" && method === "POST") {
    const { password } = await req.json().catch(() => ({}));
    if (typeof password !== "string" || !iguales(password.trim(), env.APP_PASSWORD)) {
      await new Promise(r => setTimeout(r, 800));
      return json({ error: "Contraseña incorrecta" }, 401);
    }
    const cookie = `${COOKIE}=${await tokenSesion(env)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${60 * 60 * 24 * 400}`;
    return json({ ok: true }, 200, { "Set-Cookie": cookie });
  }
  if (p === "/api/vapid") return json({ publicKey: env.VAPID_PUBLIC_KEY });
  if (!(await autenticado(req, env))) return json({ error: "Iniciá sesión" }, 401);

  if (p === "/api/logout" && method === "POST") return json({ ok: true }, 200, { "Set-Cookie": `${COOKIE}=; Path=/; Max-Age=0; Secure; HttpOnly` });

  if (p === "/api/todo" && method === "GET") {
    const { results } = await env.DB.prepare("SELECT coleccion, id, data FROM registros").all();
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
      const body = await req.text();
      if (body.length > 200000) return json({ error: "Demasiado grande" }, 413);
      try { if (typeof JSON.parse(body) !== "object") throw 0; } catch { return json({ error: "JSON inválido" }, 400); }
      await env.DB.prepare("INSERT INTO registros (coleccion, id, data, actualizado) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(coleccion, id) DO UPDATE SET data = ?3, actualizado = ?4")
        .bind(col, id, body, Date.now()).run();
      return json({ ok: true });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM registros WHERE coleccion = ?1 AND id = ?2").bind(col, id).run();
      return json({ ok: true });
    }
  }

  if (p === "/api/foto" && method === "POST") {
    const mime = req.headers.get("Content-Type") || "image/jpeg";
    if (!/^image\/(jpeg|png|webp)$/.test(mime)) return json({ error: "Formato no soportado" }, 415);
    const buf = await req.arrayBuffer();
    if (buf.byteLength > 1900000) return json({ error: "La foto es muy pesada" }, 413);
    const id = crypto.randomUUID().replace(/-/g, "");
    await env.DB.prepare("INSERT INTO fotos_blob (id, mime, data, creado) VALUES (?1, ?2, ?3, ?4)").bind(id, mime, buf, Date.now()).run();
    return json({ id, url: `/api/foto/${id}` });
  }
  m = p.match(/^\/api\/foto\/([a-f0-9]{32})$/);
  if (m) {
    if (method === "GET") {
      const row = await env.DB.prepare("SELECT mime, data FROM fotos_blob WHERE id = ?1").bind(m[1]).first();
      if (!row) return new Response("No existe", { status: 404 });
      return new Response(new Uint8Array(row.data), { headers: { "Content-Type": row.mime, "Cache-Control": "private, max-age=31536000, immutable" } });
    }
    if (method === "DELETE") {
      await env.DB.prepare("DELETE FROM fotos_blob WHERE id = ?1").bind(m[1]).run();
      return json({ ok: true });
    }
  }

  if (p === "/api/push" && method === "POST") {
    const s = await req.json().catch(() => null);
    if (!s?.endpoint || !s?.keys?.p256dh || !s?.keys?.auth || !/^https:\/\//.test(s.endpoint)) return json({ error: "Suscripción inválida" }, 400);
    await env.DB.prepare("INSERT INTO suscripciones (endpoint, p256dh, auth, creado) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(endpoint) DO UPDATE SET p256dh = ?2, auth = ?3")
      .bind(s.endpoint, s.keys.p256dh, s.keys.auth, Date.now()).run();
    return json({ ok: true });
  }
  if (p === "/api/push" && method === "DELETE") {
    const { endpoint } = await req.json().catch(() => ({}));
    if (endpoint) await env.DB.prepare("DELETE FROM suscripciones WHERE endpoint = ?1").bind(endpoint).run();
    return json({ ok: true });
  }
  if (p === "/api/push/prueba" && method === "POST") {
    const r = await enviarATodos(env, { title: "Fierro y Balanza", body: "¡Listo! Las notificaciones funcionan. Te aviso todos los días a la hora que elegiste, si hay algo." });
    return json(r);
  }
  if (p === "/api/avisos" && method === "GET") return json(await calcularAvisos(env));

  return json({ error: "No encontrado" }, 404);
}

async function enviarATodos(env, payload) {
  const { results } = await env.DB.prepare("SELECT endpoint, p256dh, auth FROM suscripciones").all();
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

/* ---------- avisos de la noche ---------- */
const ymd = d => d.toISOString().slice(0, 10);
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function calcularAvisos(env) {
  const { results } = await env.DB.prepare("SELECT coleccion, data FROM registros WHERE coleccion IN ('pesos','sesiones','fotos','ajustes','rutinas','cardio')").all();
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

  // logros de hoy
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
  return { hoy, avisos: avisos.slice(0, 3).map(a => a.t) };
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
      // El cron corre cada hora; solo se avisa a la hora elegida (por defecto 21, hora de Uruguay)
      const cfg = await env.DB.prepare("SELECT data FROM registros WHERE coleccion = 'ajustes' AND id = 'general'").first();
      const hora = (cfg ? JSON.parse(cfg.data).horaAviso : null) ?? 21;
      if (new Date(Date.now() + UY_OFFSET_H * 3600e3).getUTCHours() !== hora) return;
      const { avisos } = await calcularAvisos(env);
      if (!avisos.length) return;
      await enviarATodos(env, { title: avisos.length > 1 ? `Fierro y Balanza · ${avisos.length} avisos` : "Fierro y Balanza", body: avisos.join("\n"), url: "/" });
    })());
  }
};
