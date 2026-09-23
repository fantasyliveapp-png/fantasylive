/* eslint-disable no-console */
/**
 * Cierre de llamadas colgadas
 * ---------------------------------------------------------------------------
 * El cobro por minuto lo dispara el navegador. Si alguien cierra la pestana de
 * golpe, se queda sin bateria o simplemente deja de mandar ticks, la sesion se
 * quedaria ACTIVE para siempre: la prueba gratuita seria infinita y las
 * metricas de la creadora nunca cuadrarian.
 *
 * Este script cierra:
 *   - las llamadas gratuitas que ya agotaron su limite de minutos;
 *   - las que llevan varios intervalos sin dar senales de vida.
 *
 * Lo ejecuta cada minuto deploy/fantasylive-sweep.timer.
 *
 * Uso manual:
 *   npx tsx --conditions=react-server scripts/sweep-calls.mts
 */

import { sweepStaleCalls } from '../src/lib/calls';

async function main() {
  const started = Date.now();
  const { freeExpired, abandoned } = await sweepStaleCalls();
  const ms = Date.now() - started;

  // Silencio si no habia nada que hacer: el timer corre cada minuto y no tiene
  // sentido llenar el journal de lineas vacias.
  if (freeExpired > 0 || abandoned > 0) {
    console.log(
      `[sweep] cerradas ${freeExpired} por limite gratis, ${abandoned} abandonadas (${ms} ms)`,
    );
  }
}

main()
  .catch((error) => {
    console.error('[sweep] error:', error);
    process.exit(1);
  })
  .then(() => process.exit(0));
