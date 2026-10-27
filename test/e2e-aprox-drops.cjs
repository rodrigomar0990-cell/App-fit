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
  const n = async () => (await page.$$eval(".ex .set .n", els => els.map(e => e.textContent))).join(" ");

  await page.goto(U); await page.waitForSelector("#lPass");
  await page.fill("#lUser", "admin"); await page.fill("#lPass", PASS); await page.click("#fLogin button"); await page.waitForSelector("text=Racha");
  await page.click("nav button[data-v=gym]"); await page.click("text=Crear rutina");
  await page.fill("#rNom", "Pierna"); await page.fill("#rEj0", "Sentadilla"); await page.fill("#rSe0", "3"); await page.fill("#rRe0", "8");
  await page.click("#fRut button[type=submit]"); await toast("Rutina guardada");
  await page.click("button[data-act=empezar][data-id]"); await page.waitForSelector("#timer");

  await page.click("button[data-act=aprox]"); await toast("Poné primero el peso"); paso("aproximación pide el peso de trabajo");
  await page.fill("#kg-0-0", "80"); await page.fill("#rp-0-0", "8");
  await page.click("button[data-act=aprox]"); await toast("Aproximación para 80 kg");
  if ((await n()) !== "A1 A2 A3 1 2 3") throw new Error("Filas: " + (await n()));
  const ph = await page.$$eval(".set.aprox input[data-f=kg]", els => els.map(e => e.placeholder));
  if (ph.join("|") !== "40|55|67,5") throw new Error("Pesos de aproximación: " + ph);
  paso("aproximación: 40 × 8, 55 × 5, 67,5 × 2 para 80 kg");

  await page.click("button[data-act=okSerie][data-e='0'][data-s='0']");
  await page.waitForSelector("#rest .t:has-text('1:00')"); paso("descanso corto (1 min) después de una aproximación");
  await page.click("button[data-act=restFin]");

  await page.click("button[data-act=drop]"); await toast("Drops: 80 → 65 → 52,5 kg");
  if ((await n()) !== "A1 A2 A3 1 2 3 D1 D2") throw new Error("Filas con drops: " + (await n()));
  paso("drop sets: 80 → 65 → 52,5 kg al final");
  await page.click("button[data-act=masSerie]");
  if ((await n()) !== "A1 A2 A3 1 2 3 4 D1 D2") throw new Error("+ Serie con drops: " + (await n()));
  paso("+ Serie se agrega antes de los drops");

  // serie 1 (índice 3) y la última de trabajo (índice 6) seguida de drop: sin descanso
  await page.click("button[data-act=okSerie][data-e='0'][data-s='3']");
  for (const j of [4, 5]) { await page.fill(`#rp-0-${j}`, "8"); await page.fill(`#kg-0-${j}`, "80"); await page.click(`button[data-act=okSerie][data-e='0'][data-s='${j}']`); }
  await page.fill("#rp-0-6", "8"); await page.fill("#kg-0-6", "80");
  await page.click("button[data-act=okSerie][data-e='0'][data-s='6']"); await toast("Sin descanso");
  if (await page.$("#rest")) throw new Error("Hubo descanso antes del drop");
  paso("sin descanso antes del drop");
  await page.fill("#rp-0-7", "6"); await page.click("button[data-act=okSerie][data-e='0'][data-s='7']");
  await page.fill("#rp-0-8", "5"); await page.click("button[data-act=okSerie][data-e='0'][data-s='8']");
  await page.waitForSelector("#rest"); paso("descanso después del último drop");
  await page.screenshot({ path: OUT + "/drops.png", fullPage: true });

  await page.click("button[data-act=terminar]"); await page.click("button[data-act=guardarSesion][data-skip]");
  await page.waitForSelector("text=Medallas");
  const sem = await page.textContent("section:has(.eyebrow:text-is('Esta semana'))");
  if (!/6\s*series/.test(sem)) throw new Error("Series de la semana (sin contar aproximación): " + sem);
  paso("la aproximación no cuenta en las series de la semana (4 + 2 drops = 6)");
  await page.click("nav button[data-v=gym]");
  await page.waitForSelector(".det >> text=4 × 8 · 80 kg + 2 drops (1 de aproximación)", { state: "attached" }); paso("historial: 4 × 8 · 80 kg + 2 drops (1 de aproximación)");

  // la próxima vez, "última vez" y las series vienen sin aproximación ni drops
  await page.click("button[data-act=empezar][data-id]");
  if ((await n()) !== "1 2 3") throw new Error("Nueva sesión: " + (await n()));
  paso("la próxima sesión arranca solo con las series de trabajo");
  await page.click("button[data-act=descartar]"); await page.click("button[data-act=descartar]");

  console.log(errs.length ? "ERRORES:\n" + errs.join("\n") : "Sin errores en la consola");
  await browser.close();
})().catch(async e => { console.error("FALLÓ:", e.message); try { await globalThis.__page.screenshot({ path: OUT + "/fallo.png" }); } catch {} process.exit(1); });
