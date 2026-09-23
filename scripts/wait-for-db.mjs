/**
 * Espera a que PostgreSQL acepte conexiones antes de correr las migraciones.
 * Se usa en `npm run setup:local`, donde docker compose y prisma se encadenan.
 */
import net from 'node:net';

const url = process.env.DATABASE_URL ?? 'postgresql://fantasy:fantasy@localhost:5432/fantasylive';
const parsed = new URL(url);
const host = parsed.hostname || 'localhost';
const port = Number(parsed.port || 5432);

const TIMEOUT_MS = 60_000;
const INTERVAL_MS = 1000;
const started = Date.now();

function tryConnect() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    socket.once('connect', () => {
      socket.end();
      resolve(true);
    });
    socket.once('error', () => {
      socket.destroy();
      resolve(false);
    });
    socket.setTimeout(2000, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

console.log(`[wait-for-db] Esperando a Postgres en ${host}:${port}...`);

while (Date.now() - started < TIMEOUT_MS) {
  if (await tryConnect()) {
    console.log('[wait-for-db] Base de datos lista.');
    process.exit(0);
  }
  await new Promise((r) => setTimeout(r, INTERVAL_MS));
}

console.error(
  `[wait-for-db] Timeout tras ${TIMEOUT_MS / 1000}s. Comprueba que el contenedor este arrancado (docker compose ps).`,
);
process.exit(1);
