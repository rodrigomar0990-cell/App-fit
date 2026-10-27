# Fierro y Balanza

App personal para registrar el peso, fotos de progreso y entrenamientos del gimnasio, con rachas, medallas y notificaciones diarias.

Publicada en: https://fierro-y-balanza.misticpuntos.workers.dev

## Cómo está armada
- `public/`: la app (una sola página, `index.html`), el service worker (`sw.js`) para instalarla y recibir notificaciones, el manifest y los íconos.
- `src/worker.js`: el servidor en Cloudflare Workers: inicio de sesión, guardado de datos y fotos, y el cálculo de avisos.
- `src/push.js`: envío de notificaciones Web Push (VAPID + cifrado aes128gcm) sin dependencias.
- Base de datos: Cloudflare D1 `fierro-y-balanza` (ver `schema.sql`).
- Avisos: el cron corre cada hora y el worker avisa solo a la hora elegida en la app (por defecto 21:00 en Uruguay).
- Sin señal: los cambios quedan en una cola en el celular (`localStorage`) y se suben al volver la conexión.

## Secretos (no están en el repo)
Se cargan con `npx wrangler secret put <NOMBRE>`:
- `APP_PASSWORD`: contraseña para entrar a la app.
- `VAPID_PRIVATE_JWK`: clave privada de notificaciones (JWK). Si se cambia, también hay que cambiar `VAPID_PUBLIC_KEY` en `wrangler.toml` y volver a activar las notificaciones en cada celular.

## Publicar cambios
```
npm install
npx wrangler deploy
```

## Pruebas
```
node test/push.test.mjs    # el cifrado coincide con la librería de referencia
node test/vapid.test.mjs   # la firma VAPID es válida
```

Prueba completa en navegador (ver instrucciones al principio de `test/e2e.cjs`): necesita `npx wrangler dev --local`, un `.dev.vars` con `APP_PASSWORD` y `VAPID_PRIVATE_JWK`, y la base local creada con `npx wrangler d1 execute fierro-y-balanza --local --file schema.sql`.

Íconos: `NODE_PATH=$(npm root -g) node scripts/iconos.cjs` (usa Playwright).
