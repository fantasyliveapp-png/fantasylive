import 'server-only';

import { readFile, stat } from 'node:fs/promises';

import { config } from '@/lib/config';

/**
 * DETECCION DE VPN
 *
 * Compara la IP de quien visita con una lista publica de rangos de servicios
 * VPN (deploy/update-vpn-list.sh la descarga a diario). Solo IPv4: una IPv6
 * no se marca nunca como VPN.
 *
 * Se usa para el bloqueo por paises: con una VPN cualquiera aparenta estar en
 * otro pais, asi que a quien entra por VPN no se le muestran los perfiles que
 * bloquean algun pais.
 */

/** Rangos [inicio, fin] como enteros, ordenados por inicio. */
let ranges: Uint32Array | null = null;
let loadedMtime = 0;
let lastCheck = 0;
let loading: Promise<void> | null = null;

const RECHECK_MS = 10 * 60 * 1000;

function ipToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = 0;
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = n * 256 + v;
  }
  return n;
}

function parse(text: string): Uint32Array {
  const list: Array<[number, number]> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [addr, bitsRaw] = line.split('/');
    const start = ipToInt(addr ?? '');
    const bits = bitsRaw === undefined ? 32 : Number(bitsRaw);
    if (start === null || !Number.isInteger(bits) || bits < 8 || bits > 32) continue;
    const size = 2 ** (32 - bits);
    const base = start - (start % size);
    list.push([base, base + size - 1]);
  }
  list.sort((a, b) => a[0] - b[0]);
  // Une rangos solapados: asi la busqueda binaria basta con mirar uno.
  const merged: Array<[number, number]> = [];
  for (const r of list) {
    const last = merged[merged.length - 1];
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1]);
    else merged.push([r[0], r[1]]);
  }
  const out = new Uint32Array(merged.length * 2);
  merged.forEach(([a, b], i) => {
    out[i * 2] = a;
    out[i * 2 + 1] = b;
  });
  return out;
}

async function refresh() {
  try {
    const info = await stat(config.geo.vpnListFile);
    if (info.mtimeMs === loadedMtime && ranges) return;
    ranges = parse(await readFile(config.geo.vpnListFile, 'utf8'));
    loadedMtime = info.mtimeMs;
  } catch {
    // Sin lista: no se detectan VPN.
    ranges = null;
  }
}

/** Relee la lista como mucho cada 10 minutos (y solo si el fichero cambio). */
async function ensureLoaded() {
  if (Date.now() - lastCheck >= RECHECK_MS) {
    lastCheck = Date.now();
    loading ??= refresh().finally(() => {
      loading = null;
    });
  }
  if (loading) await loading;
}

/** true si la IP pertenece a un servicio VPN conocido. Nunca lanza. */
export async function isVpnIp(ip: string | null | undefined): Promise<boolean> {
  if (config.geo.overrideVpn) return true;
  if (!ip) return false;
  const n = ipToInt(ip.startsWith('::ffff:') ? ip.slice(7) : ip);
  if (n === null) return false;
  await ensureLoaded();
  const r = ranges;
  if (!r || r.length === 0) return false;
  // Busqueda binaria del ultimo rango con inicio <= n.
  let lo = 0;
  let hi = r.length / 2 - 1;
  let found = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (r[mid * 2]! <= n) {
      found = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return found >= 0 && n <= r[found * 2 + 1]!;
}
