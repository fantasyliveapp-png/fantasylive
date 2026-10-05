/* eslint-disable no-console */
/**
 * Resumen semanal de creadoras (correo 14)
 * ---------------------------------------------------------------------------
 * Lo ejecuta cada lunes deploy/fantasylive-weekly.timer.
 *
 * Uso manual:
 *   npx tsx --conditions=react-server scripts/weekly-creator-summary.mts
 *   ... --force   (envia aunque ya se mandara esta semana)
 */

import { sendWeeklySummaries } from '../src/lib/weekly-summary';

async function main() {
  const r = await sendWeeklySummaries({ force: process.argv.includes('--force') });
  if (r.noEmail) console.log('[weekly] el correo no esta configurado (SMTP_HOST): no se envia nada');
  else if (r.alreadyDone) console.log(`[weekly] la semana ${r.week} ya se envio; nada que hacer`);
  else console.log(`[weekly] ${r.week}: ${r.sent} enviados, ${r.skipped} sin actividad`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('[weekly] error', error);
    process.exit(1);
  });
