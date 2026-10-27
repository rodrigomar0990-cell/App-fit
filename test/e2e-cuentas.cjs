// Prueba en navegador contra una copia local con una cuenta admin/prueba123 (ver README).
const { chromium } = require("playwright");
const U = process.argv[2] || "http://localhost:8787", OUT = process.argv[3];
const paso = (n) => console.log("✓", n);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["clipboard-read", "clipboard-write"] });
  const page = await ctx.newPage(); globalThis.__page = page;
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/40[13]|409/.test(m.text())) errs.push(m.text()); });
  const toast = async (txt) => page.waitForSelector(`.toast:has-text("${txt}")`, { timeout: 8000 });
  const entrar = async (u, p) => { await page.waitForSelector("#fLogin"); await page.fill("#lUser", u); await page.fill("#lPass", p); await page.click("#fLogin button[type=submit]"); };
  const api = (path, opts) => page.evaluate(async ([p, o]) => { const r = await fetch(p, o); return { status: r.status, body: await r.text() }; }, [path, opts || {}]);

  // admin
  await page.goto(U); await entrar("admin", "prueba123");
  await page.waitForSelector("text=Hola, Admin"); paso("admin entra con usuario y contraseña");
  await page.waitForSelector("text=Código: fierro-prueba");
  await page.click("button[data-act=invCopiar]"); await toast("Invitación copiada");
  const inv = await page.evaluate(() => navigator.clipboard.readText());
  if (!inv.includes("/#invitacion=fierro-prueba")) throw new Error("Invitación: " + inv);
  paso("copiar invitación con link");
  await page.click("nav button[data-v=peso]"); await page.fill("#pKg", "80"); await page.click("#fPeso button[type=submit]"); await toast("Guardado");
  const fotoAdmin = JSON.parse((await api("/api/foto", { method: "POST", headers: { "Content-Type": "image/png" }, body: "x" })).body).id;
  await page.click("nav button[data-v=inicio]");
  await page.click("button[data-act=logout]"); await page.waitForSelector("#fLogin"); paso("cerrar sesión");

  // amigo con el link
  await page.goto(U + "/#invitacion=fierro-prueba"); await page.waitForSelector("#fRegistro");
  if ((await page.inputValue("#rgCodigo")) !== "fierro-prueba") throw new Error("El código no vino del link");
  paso("el link de invitación abre Crear cuenta con el código");
  await page.fill("#rgNombre", "Juan"); await page.fill("#rgUser", "juan"); await page.fill("#rgPass", "secreto1"); await page.fill("#rgCodigo", "mal-codigo");
  await page.click("#fRegistro button[type=submit]"); await toast("El código de invitación no es válido"); paso("código equivocado: no deja crear cuenta");
  await page.fill("#rgCodigo", "fierro-prueba"); await page.fill("#rgUser", "admin");
  await page.click("#fRegistro button[type=submit]"); await toast("Ese usuario ya existe"); paso("usuario repetido: avisa");
  await page.fill("#rgUser", "Juan Perez"); await page.click("#fRegistro button[type=submit]"); await toast("El usuario tiene que tener"); paso("usuario inválido: avisa");
  await page.fill("#rgUser", "juan"); await page.click("#fRegistro button[type=submit]");
  await page.waitForSelector("text=Hola, Juan"); paso("Juan crea su cuenta");
  if (await page.$("text=Invitar amigos")) throw new Error("Juan ve la tarjeta de invitar");
  if (await page.$("text=82,4") || await page.$(".num.big")) throw new Error("Juan ve datos que no son suyos");
  const todoJuan = JSON.parse((await api("/api/todo")).body);
  if (todoJuan.pesos.length) throw new Error("Juan recibe pesos ajenos");
  paso("Juan no ve los datos del admin");
  if ((await api("/api/foto/" + fotoAdmin)).status !== 404) throw new Error("Juan puede ver una foto ajena");
  if ((await api("/api/invitacion")).status !== 403) throw new Error("Juan puede ver el código");
  paso("Juan no puede abrir fotos ajenas ni ver el código");
  await page.click("nav button[data-v=peso]"); await page.fill("#pKg", "70"); await page.click("#fPeso button[type=submit]"); await toast("Guardado");

  // cambio de contraseña
  await page.click("nav button[data-v=inicio]"); await page.click("button[data-act=cambiarPass]");
  await page.fill("#pwActual", "secreto1"); await page.fill("#pwNueva", "nueva123"); await page.fill("#pwRepe", "nueva123");
  await page.click("#fPass button[type=submit]"); await toast("Contraseña cambiada");
  await page.click("button[data-act=logout]");
  await entrar("juan", "secreto1"); await toast("Usuario o contraseña incorrectos");
  await page.fill("#lPass", "nueva123"); await page.click("#fLogin button[type=submit]"); await page.waitForSelector("text=Hola, Juan");
  await page.waitForSelector(".num.big:has-text('70')"); paso("cambio de contraseña y sus datos siguen ahí");
  await page.screenshot({ path: OUT + "/cuenta-juan.png", fullPage: true });

  // admin no ve lo de Juan
  await page.click("button[data-act=logout]"); await entrar("admin", "prueba123"); await page.waitForSelector("text=Hola, Admin");
  await page.waitForSelector(".num.big:has-text('80')");
  await page.waitForSelector("text=2 personas usan la app"); paso("admin ve solo lo suyo y el contador de personas");

  // Juan borra su cuenta
  await page.click("button[data-act=logout]"); await entrar("juan", "nueva123"); await page.waitForSelector("text=Hola, Juan");
  await page.click("button[data-act=borrarCuenta]"); await page.fill("#bcPass", "nueva123");
  await page.click("button[data-act=confirmarBorrarCuenta]"); await page.click("button[data-act=confirmarBorrarCuenta]");
  await toast("Tu cuenta y tus datos se borraron"); await page.waitForSelector("#fLogin");
  await entrar("juan", "nueva123"); await toast("Usuario o contraseña incorrectos"); paso("borrar cuenta elimina el acceso");
  await page.fill("#lUser", "admin"); await page.fill("#lPass", "prueba123"); await page.click("#fLogin button[type=submit]");
  await page.waitForSelector("text=1 persona usa la app"); paso("después del borrado queda 1 persona");
  await page.screenshot({ path: OUT + "/cuenta-admin.png", fullPage: true });

  console.log(errs.length ? "ERRORES:\n" + errs.join("\n") : "Sin errores en la consola");
  await browser.close();
})().catch(async e => { console.error("FALLÓ:", e.message); try { await globalThis.__page.screenshot({ path: OUT + "/fallo.png" }); } catch {} process.exit(1); });
