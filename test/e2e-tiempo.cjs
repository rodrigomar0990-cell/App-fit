// Prueba en navegador contra una copia local con una cuenta admin/prueba123 (ver README).
const { chromium } = require("playwright");
const U = process.argv[2] || "http://localhost:8787", OUT = process.argv[3], PASS = process.argv[4] || "prueba123";
const paso = (n) => console.log("✓", n);
(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await ctx.newPage(); globalThis.__page = page;
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/401/.test(m.text())) errs.push(m.text()); });
  const toast = async (txt) => page.waitForSelector(`.toast:has-text("${txt}")`, { timeout: 8000 });

  await page.goto(U); await page.waitForSelector("#lPass");
  await page.fill("#lUser", "admin"); await page.fill("#lPass", PASS); await page.click("#fLogin button"); await page.waitForSelector("text=Racha");

  await page.click("nav button[data-v=gym]"); await page.click("text=Crear rutina");
  await page.fill("#rNom", "Día B"); await page.fill("#rEj0", "Sentadilla"); await page.fill("#rSe0", "1"); await page.fill("#rRe0", "8");
  await page.click("button[data-act=addEjRut]"); await page.fill("#rEj1", "Plancha"); await page.fill("#rSe1", "1"); await page.fill("#rRe1", "3");
  await page.click("#fRut button[type=submit]"); await toast("Rutina guardada");

  // sesión 1
  await page.click("button[data-act=empezar][data-id]"); await page.waitForSelector("#timer");
  await page.waitForSelector(".ex:has-text('Plancha') .pill:has-text('Por tiempo')");
  await page.waitForSelector(".ex:has-text('Plancha') .set-h:has-text('seg')"); paso("Plancha detectada como ejercicio por tiempo");
  await page.fill("#kg-0-0", "60"); await page.fill("#rp-0-0", "8"); await page.click("button[data-act=okSerie][data-e='0'][data-s='0']");
  await page.click("button[data-act=crono][data-e='1']"); await page.waitForSelector("#crono");
  await page.waitForSelector("#crono.fin", { timeout: 6000 }); paso("cronómetro avisa al llegar al objetivo (3 s)");
  await page.screenshot({ path: OUT + "/crono.png" });
  await page.click("button[data-act=cronoParar]"); await toast("Serie guardada");
  if (!(await page.$(".ex:has-text('Plancha') .set.ok"))) throw new Error("La serie de plancha no quedó marcada");
  paso("cronómetro guarda la serie");
  await page.click("button[data-act=terminar]"); await page.click("button[data-act=guardarSesion][data-skip]"); await page.waitForSelector("text=Medallas");

  // sesión 2: plancha más larga = récord
  await page.click("nav button[data-v=gym]"); await page.click("button[data-act=empezar][data-id]");
  await page.fill("#rp-1-0", "50"); await page.click("button[data-act=okSerie][data-e='1'][data-s='0']");
  await page.click("button[data-act=terminar]"); await page.click("button[data-act=guardarSesion][data-skip]");
  await toast("Plancha 50 s"); paso("récord por tiempo (50 s)");
  await page.waitForSelector(".li:has-text('Plancha') >> text=50 s"); paso("récord por tiempo en Últimos récords");

  // grupos musculares
  await page.click("nav button[data-v=gym]");
  await page.waitForSelector("text=Series por músculo");
  const txt = await page.textContent("section:has-text('Series por músculo')");
  if (!/Piernas\s*1 serie/.test(txt) || !/Core \/ abdomen\s*2 series/.test(txt) || !/Sin trabajar:.*Pecho/.test(txt)) throw new Error("Conteo por músculo inesperado: " + txt);
  paso("series por músculo (Piernas 1, Core 2, Pecho sin trabajar)");
  await page.waitForSelector(".det >> text=1 × 50 s", { state: "attached" }); paso("historial muestra segundos");

  // ajustes del ejercicio: cambiar grupo de Sentadilla a Glúteos
  await page.selectOption("#ejSel", "Sentadilla");
  await page.click("button[data-act=ajustesEj]"); await page.selectOption("#ajGrupo", "gluteos"); await page.fill("#nTexto", "Bajar profundo");
  await page.click("button[data-act=guardarAjustesEj]"); await toast("Ejercicio guardado");
  await page.waitForSelector(".pill:has-text('Glúteos')"); await page.waitForSelector(".nota:has-text('Bajar profundo')");
  const txt2 = await page.textContent("section:has-text('Series por músculo')");
  if (!/Glúteos\s*1 serie/.test(txt2)) throw new Error("No se reasignó el grupo: " + txt2);
  paso("ajustes del ejercicio: grupo y nota");
  await page.locator("section:has-text('Series por músculo')").screenshot({ path: OUT + "/musculos.png" });

  console.log(errs.length ? "ERRORES:\n" + errs.join("\n") : "Sin errores en la consola");
  await browser.close();
})().catch(async e => { console.error("FALLÓ:", e.message); try { await globalThis.__page.screenshot({ path: OUT + "/fallo.png" }); } catch {} process.exit(1); });
