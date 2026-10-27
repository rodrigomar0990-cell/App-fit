// Genera los íconos PNG de la app a partir de un SVG (NODE_PATH=$(npm root -g) node scripts/iconos.cjs).
const { chromium } = require("playwright");
(async () => {

const pesa = (color) => `
  <g fill="${color}">
    <rect x="132" y="160" width="44" height="192" rx="14"/>
    <rect x="336" y="160" width="44" height="192" rx="14"/>
    <rect x="96" y="200" width="32" height="112" rx="10"/>
    <rect x="384" y="200" width="32" height="112" rx="10"/>
    <rect x="172" y="238" width="168" height="36" rx="8"/>
  </g>`;
const icono = (pad, radio) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="${radio}" fill="#0A0A0B"/>
  <g transform="translate(256 256) scale(${1 - pad}) translate(-256 -256)">${pesa("#D8B24A")}</g></svg>`;
const badge = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">${pesa("#FFFFFF")}</svg>`;

const salidas = [
  ["icon-192.png", 192, icono(0, 96)], ["icon-512.png", 512, icono(0, 96)],
  ["maskable-512.png", 512, icono(0.25, 0)], ["apple-touch-icon.png", 180, icono(0.08, 0)],
  ["badge-96.png", 96, badge]
];
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [nombre, size, svg] of salidas) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body></html>`);
  await page.screenshot({ path: `public/icons/${nombre}`, omitBackground: true, clip: { x: 0, y: 0, width: size, height: size } });
}
await browser.close();
console.log("Íconos listos");
})();
