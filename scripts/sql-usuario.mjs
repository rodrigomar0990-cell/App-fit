// Imprime el SQL para crear (o reemplazar) una cuenta, con la contraseña ya cifrada igual que el worker.
// Uso: node scripts/sql-usuario.mjs <usuario> "<nombre>" "<contraseña>" [admin]
// Ejemplo: node scripts/sql-usuario.mjs rodrigo "Rodrigo" "secreto" admin > /tmp/u.sql
//          npx wrangler d1 execute fierro-y-balanza --remote --file /tmp/u.sql
const [usuario, nombre, password, admin] = process.argv.slice(2);
if (!usuario || !nombre || !password) { console.error("Uso: node scripts/sql-usuario.mjs <usuario> <nombre> <contraseña> [admin]"); process.exit(1); }
const hex = b => [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
const saltBytes = crypto.getRandomValues(new Uint8Array(16));
const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password.trim()), "PBKDF2", false, ["deriveBits"]);
const hash = hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: saltBytes, iterations: 20000 }, key, 256));
const q = s => "'" + String(s).replace(/'/g, "''") + "'";
console.log(`INSERT INTO usuarios (usuario, nombre, hash, salt, admin, creado) VALUES (${q(usuario.toLowerCase())}, ${q(nombre)}, ${q(hash)}, ${q(hex(saltBytes))}, ${admin === "admin" ? 1 : 0}, ${Date.now()}) ON CONFLICT(usuario) DO UPDATE SET nombre = excluded.nombre, hash = excluded.hash, salt = excluded.salt, admin = excluded.admin;`);
