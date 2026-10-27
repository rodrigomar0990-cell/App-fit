# Fierro y Balanza

App para registrar el peso, fotos de progreso y entrenamientos del gimnasio, con rachas, medallas y notificaciones diarias. Cada persona tiene su cuenta y sus datos separados; se entra por invitación.

Publicada en: https://fierro-y-balanza.misticpuntos.workers.dev

## Cómo está armada
- `public/`: la app (una sola página, `index.html`), el service worker (`sw.js`) para instalarla y recibir notificaciones, el manifest y los íconos.
- `src/worker.js`: el servidor en Cloudflare Workers: inicio de sesión, guardado de datos y fotos, y el cálculo de avisos.
- `src/push.js`: envío de notificaciones Web Push (VAPID + cifrado aes128gcm) sin dependencias.
- Base de datos: Cloudflare D1 `fierro-y-balanza` (ver `schema.sql`). Todo se guarda con la columna `usuario`.
- Cuentas: usuario + contraseña (PBKDF2), sesiones en `sesiones_login` (se guarda el SHA-256 del token). Para crear cuenta hace falta el código de invitación (`config.invitacion`), que la cuenta admin ve y cambia desde la app.
- Avisos: el cron corre cada hora y el worker avisa solo a la hora elegida en la app (por defecto 21:00 en Uruguay).
- Sin señal: los cambios quedan en una cola en el celular (`localStorage`) y se suben al volver la conexión.

## Cuentas a mano
`node scripts/sql-usuario.mjs <usuario> "<nombre>" "<contraseña>" [admin]` imprime el SQL para crear o resetear una cuenta (por ejemplo, si alguien se olvida la contraseña). Se ejecuta en la base con `npx wrangler d1 execute fierro-y-balanza --remote --file <archivo.sql>` o desde el panel de D1.

## Secretos (no están en el repo)
Se cargan con `npx wrangler secret put <NOMBRE>`:
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

Pruebas en navegador (`test/e2e*.cjs`): necesitan `npx wrangler dev --local`, un `.dev.vars` con `VAPID_PRIVATE_JWK`, la base local creada con `npx wrangler d1 execute fierro-y-balanza --local --file schema.sql`, una cuenta `admin` con contraseña `prueba123` (con `scripts/sql-usuario.mjs ... admin`) y el código de invitación `fierro-prueba` en la tabla `config`. Después: `NODE_PATH=$(npm root -g) node test/e2e.cjs http://localhost:8787 <carpeta-capturas> prueba123`.

Íconos: `NODE_PATH=$(npm root -g) node scripts/iconos.cjs` (usa Playwright).
