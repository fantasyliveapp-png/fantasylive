import 'server-only';

import { prisma } from '@/lib/prisma';

/**
 * TIPOS DE CAMBIO OFICIALES (USD -> otras monedas). Solo se usan para guardar
 * en cada venta de un distribuidor una referencia de auditoria; no se muestran
 * porque en algunos paises el cambio real es otro. Se piden a open.er-api.com como mucho cada 6 h y se
 * guardan en platform_settings: si la API falla, se usa el ultimo conocido.
 */

const KEY = 'fx_usd_rates';
const MAX_AGE_MS = 6 * 3600_000;

type Stored = { rates: Record<string, number>; fetchedAt: string };

export async function getUsdRates(): Promise<{ rates: Record<string, number>; fetchedAt: string | null }> {
  const row = await prisma.platformSetting.findUnique({ where: { key: KEY } });
  const stored = (row?.value ?? null) as Stored | null;
  const fresh = stored && Date.now() - new Date(stored.fetchedAt).getTime() < MAX_AGE_MS;
  if (fresh) return stored!;

  try {
    const res = await fetch('https://open.er-api.com/v6/latest/USD', { cache: 'no-store', signal: AbortSignal.timeout(8000) });
    const data = (await res.json()) as { result?: string; rates?: Record<string, number> };
    if (data.result === 'success' && data.rates?.USD === 1) {
      const value: Stored = { rates: data.rates, fetchedAt: new Date().toISOString() };
      await prisma.platformSetting.upsert({
        where: { key: KEY },
        create: { key: KEY, value, description: 'Tipos de cambio USD (distribuidores)' },
        update: { value },
      });
      return value;
    }
  } catch {
    // sin red: se usa lo ultimo guardado
  }
  return stored ?? { rates: { USD: 1 }, fetchedAt: null };
}

/** Unidades de `currency` por 1 USD (null si no se conoce). */
export async function usdRate(currency: string): Promise<number | null> {
  if (currency === 'USD') return 1;
  const { rates } = await getUsdRates();
  return rates[currency] ?? null;
}
