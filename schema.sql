CREATE TABLE IF NOT EXISTS usuarios (usuario TEXT PRIMARY KEY, nombre TEXT NOT NULL, hash TEXT NOT NULL, salt TEXT NOT NULL, admin INTEGER NOT NULL DEFAULT 0, creado INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS sesiones_login (token TEXT PRIMARY KEY, usuario TEXT NOT NULL, creado INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS config (clave TEXT PRIMARY KEY, valor TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS registros (usuario TEXT NOT NULL, coleccion TEXT NOT NULL, id TEXT NOT NULL, data TEXT NOT NULL, actualizado INTEGER NOT NULL, PRIMARY KEY (usuario, coleccion, id));
CREATE TABLE IF NOT EXISTS fotos_blob (id TEXT PRIMARY KEY, mime TEXT NOT NULL, data BLOB NOT NULL, creado INTEGER NOT NULL, usuario TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS suscripciones (endpoint TEXT PRIMARY KEY, p256dh TEXT NOT NULL, auth TEXT NOT NULL, creado INTEGER NOT NULL, usuario TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS sesiones_por_usuario ON sesiones_login (usuario);
CREATE INDEX IF NOT EXISTS fotos_por_usuario ON fotos_blob (usuario);
CREATE INDEX IF NOT EXISTS suscripciones_por_usuario ON suscripciones (usuario);
