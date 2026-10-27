// Prueba de punta a punta contra una copia local: npx wrangler dev --local, después
// NODE_PATH=$(npm root -g) node test/e2e.cjs http://localhost:8787 <carpeta-capturas> <contraseña-de-.dev.vars>
const { chromium } = require("playwright");
const U = process.argv[2] || "http://localhost:8787", OUT = process.argv[3], PASS = process.argv[4] || "prueba123";
const paso = (n) => console.log("✓", n);
(async () => {
  const browser = await chromium.launch({ args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] });
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, permissions: ["camera"] });
  const page = await ctx.newPage(); globalThis.__page = page;
  const errs = [];
  page.on("pageerror", e => errs.push("pageerror: " + e.message));
  page.on("console", m => { if (m.type() === "error" && !/401/.test(m.text())) errs.push(m.text()); });
  const toast = async (txt) => page.waitForSelector(`.toast:has-text("${txt}")`, { timeout: 8000 });

  await page.goto(U); await page.waitForSelector("#lPass");
  await page.fill("#lPass", PASS); await page.click("#fLogin button");
  await page.waitForSelector("text=Racha"); paso("login");

  // rutinas y plan
  await page.click("nav button[data-v=gym]"); await page.click("text=Crear rutina");
  await page.fill("#rNom", "Día A"); await page.fill("#rEj0", "Sentadilla"); await page.fill("#rRe0", "8");
  await page.click("#fRut button[type=submit]"); await toast("Rutina guardada");
  const hoyI = await page.evaluate(() => (new Date().getDay() + 6) % 7);
  const idRut = await page.getAttribute("button[data-act=empezar][data-id]", "data-id");
  await page.selectOption(`select[data-plan="${hoyI}"]`, idRut); await toast("Plan guardado"); paso("plan de la semana");
  await page.click("nav button[data-v=inicio]");
  await page.waitForSelector("text=Hoy toca Día A"); paso("Inicio muestra 'Hoy toca'");

  // entrenamiento desde Inicio + nota + discos
  await page.click("text=Hoy toca Día A");
  await page.waitForSelector("#timer");
  await page.click("button[data-act=ajustesEj]"); await page.fill("#nTexto", "Agarre más cerrado"); await page.click("button[data-act=guardarAjustesEj]");
  await toast("Ejercicio guardado"); await page.waitForSelector(".nota:has-text('Agarre más cerrado')"); paso("nota por ejercicio");
  await page.fill("#kg-0-0", "87,5"); await page.click("button[data-act=discos][data-e='0']");
  await page.waitForSelector("text=25 + 5 + 2,5 + 1,25 kg"); await page.screenshot({ path: OUT + "/discos.png" }); paso("calculadora de discos (87,5 kg)");
  await page.click(".sheet button[data-act=cerrar]");
  await page.fill("#rp-0-0", "8"); await page.click("button[data-act=okSerie][data-e='0'][data-s='0']");
  await page.click("button[data-act=terminar]"); await page.click("button[data-act=guardarSesion][data-skip]");
  await page.waitForSelector("text=Medallas"); paso("entrenamiento guardado");

  // cardio + calendario
  await page.click("nav button[data-v=gym]");
  await page.fill("#cMin", "25"); await page.fill("#cKm", "3,2"); await page.click("#fCardio button[type=submit]");
  await toast("Cardio guardado"); await page.waitForSelector(".heat svg rect.hg"); paso("cardio + calendario del año");
  await page.locator(".heat").scrollIntoViewIfNeeded(); await page.screenshot({ path: OUT + "/gym.png", fullPage: true });

  // sin señal: anotar peso offline y que se suba al volver
  await ctx.setOffline(true);
  await page.click("nav button[data-v=peso]"); await page.fill("#pKg", "81,9"); await page.click("#fPeso button[type=submit]");
  await toast("Sin señal"); await page.waitForSelector("text=1 cambio guardado"); paso("guardado sin señal (en cola)");
  await ctx.setOffline(false);
  await page.waitForSelector("text=1 cambio guardado", { state: "detached", timeout: 10000 });
  const pesosServidor = await page.evaluate(async () => (await (await fetch("/api/todo")).json()).pesos.map(p => p.kg));
  if (!pesosServidor.includes(81.9)) throw new Error("El peso offline no llegó al servidor: " + pesosServidor);
  paso("al volver la señal se subió al servidor");

  // fotos: dos días distintos por API para probar evolución
  const png = await page.evaluate(async () => {
    const c = document.createElement("canvas"); c.width = 300; c.height = 400; const x = c.getContext("2d");
    const out = [];
    for (const [col, f] of [["#553", "2026-09-01"], ["#a83", "2026-10-01"]]) {
      x.fillStyle = col; x.fillRect(0, 0, 300, 400);
      const b = await new Promise(ok => c.toBlob(ok, "image/jpeg"));
      const r = await (await fetch("/api/foto", { method: "POST", headers: { "Content-Type": "image/jpeg" }, body: b })).json();
      const id = "f" + f.replace(/-/g, "");
      await fetch(`/api/r/fotos/${id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fecha: f, pose: "frente", assetId: r.id, url: r.url }) });
      out.push(id);
    }
    return out;
  });
  await page.reload(); await page.waitForSelector("nav.tabs:not([hidden])"); await page.waitForTimeout(1000);
  await page.click("nav button[data-v=fotos]"); await page.click("button[data-act=evolucion]");
  await page.waitForSelector("#evoTag:has-text('2026')"); paso("evolución en fotos");
  await page.click("button[data-act=evoCerrar]");

  // cámara con guía (cámara falsa del navegador)
  await page.click("button[data-act=camara]"); await page.waitForSelector("#cam video");
  await page.waitForFunction(() => document.querySelector("#cam video").videoWidth > 0);
  const guia = await page.$("#cam .guia"); if (!guia) throw new Error("No aparece la guía de la foto anterior");
  await page.screenshot({ path: OUT + "/camara.png" });
  await page.click("#camTimerBtn"); // 10 s -> sin timer
  if ((await page.textContent("#camTimerBtn")) !== "Sin timer") throw new Error("El timer no cambió");
  await page.click("button[data-act=camDisparar]"); await toast("Foto guardada"); paso("cámara con guía: foto sacada y subida");

  // compartir medalla
  await page.click("nav button[data-v=inicio]"); await page.click("button[data-act=compartirMedalla]");
  await page.waitForSelector(".share-img"); await page.screenshot({ path: OUT + "/compartir.png" }); paso("imagen para compartir");
  await page.click(".sheet button[data-act=cerrar]");

  // informe
  await page.click("button[data-act=informe]"); await page.waitForSelector(".informe");
  await page.screenshot({ path: OUT + "/informe.png", fullPage: true }); paso("informe para el nutri");
  await page.click(".sheet .no-print button[data-act=cerrar]");

  // resumen del mes
  await page.click("button[data-act=resumenMes]"); await page.waitForSelector("button[data-act=compartirMes]"); paso("resumen del mes con compartir");
  await page.click(".sheet button[data-act=cerrar]");
  await page.screenshot({ path: OUT + "/inicio.png", fullPage: true });

  console.log(errs.length ? "ERRORES:\n" + errs.join("\n") : "Sin errores en la consola");
  await browser.close();
})().catch(async e => { console.error("FALLÓ:", e.message); try { const p = globalThis.__page; await p.screenshot({ path: OUT + "/fallo.png" }); console.log(await p.evaluate(() => document.querySelector(".sheet")?.innerText || "sin sheet")); } catch (x) { console.log(x.message); } process.exit(1); });
