/* eslint-disable no-console */
/**
 * Distribuidores de PRUEBA en varios paises, cada uno con los metodos de pago
 * de su pais, sus paquetes y un historial (lotes y ventas a fans) para ver el
 * panel del admin con datos. Solo para desarrollo.
 *
 *   npm run db:seed-distributors
 *
 * Se puede repetir: borra y vuelve a crear las cuentas dist.*@fantasylive.test.
 * Las ventas de prueba NO tocan el saldo de los fans.
 */
import 'dotenv/config';
import { randomUUID } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();
const TOKEN_VALUE_CENTS = Number(process.env.TOKEN_VALUE_CENTS ?? 10);
const PASSWORD = process.env.SEED_PASSWORD || 'Password123!';
const MAX_DISCOUNT = Math.min(20, Number(process.env.DISTRIBUTOR_DISCOUNT_PERCENT ?? 20));
// Igual que DISCOUNT_TIERS en src/lib/distributor-shared.ts
const TIERS = [
  [1_000, 8],
  [5_000, 11],
  [10_000, 14],
  [25_000, 16],
  [50_000, 18],
  [100_000, 20],
] as const;
const discountFor = (t: number) => Math.min(MAX_DISCOUNT, TIERS.filter(([m]) => t >= m).at(-1)?.[1] ?? 0);

const FALLBACK_RATES: Record<string, number> = {
  USD: 1, MXN: 18, COP: 3900, VES: 160, PEN: 3.6, ARS: 1400, EUR: 0.87, CLP: 950, BRL: 5.3,
};

type Acc = { country: string; currency: string; method: string; details: string };
type Seed = {
  email: string;
  name: string;
  legalName: string;
  country: string;
  countries: string[];
  contact: string;
  /** Precio frente al oficial (1 = igual; 0,95 = un 5% mas barato). */
  priceFactor: number;
  available: boolean;
  lots: number[];
  accounts: Acc[];
};

const SEEDS: Seed[] = [
  {
    email: 'dist.co@fantasylive.test', name: 'Camila Rojas', legalName: 'Camila Rojas Pagos', country: 'CO', countries: ['CO'],
    contact: 'WhatsApp +57 300 000 0000', priceFactor: 0.97, available: true, lots: [10_000, 25_000],
    accounts: [
      { country: 'CO', currency: 'COP', method: 'nequi', details: 'Nequi 300 000 0000 a nombre de Camila Rojas' },
      { country: 'CO', currency: 'COP', method: 'daviplata', details: 'Daviplata 300 000 0000 · Camila Rojas' },
      { country: 'CO', currency: 'COP', method: 'bank', details: 'Bancolombia ahorros 000-000000-00 · C.C. 0000000' },
    ],
  },
  {
    email: 'dist.ve@fantasylive.test', name: 'Luis Pérez', legalName: 'Tokens Venezuela LP', country: 'VE', countries: ['VE', 'US'],
    contact: 'Telegram @tokensve', priceFactor: 1, available: true, lots: [5_000, 10_000, 50_000],
    accounts: [
      { country: 'VE', currency: 'VES', method: 'pagomovil', details: 'Pago Móvil · Banesco (0134) · 0414-000-0000 · V-00000000' },
      { country: 'VE', currency: 'USD', method: 'binance', details: 'Binance Pay ID 000000000' },
      { country: 'US', currency: 'USD', method: 'zelle', details: 'Zelle: tokensve@example.com (Luis Perez)' },
    ],
  },
  {
    email: 'dist.pe@fantasylive.test', name: 'Rosa Quispe', legalName: 'Rosa Quispe Tokens', country: 'PE', countries: ['PE'],
    contact: 'WhatsApp +51 900 000 000', priceFactor: 0.98, available: true, lots: [5_000],
    accounts: [
      { country: 'PE', currency: 'PEN', method: 'yape', details: 'Yape 900 000 000 · Rosa Quispe' },
      { country: 'PE', currency: 'PEN', method: 'plin', details: 'Plin 900 000 000 · Rosa Quispe' },
      { country: 'PE', currency: 'PEN', method: 'bank', details: 'BCP cuenta 000-00000000-0-00 · CCI 00200000000000000000' },
    ],
  },
  {
    email: 'dist.ar@fantasylive.test', name: 'Martín Gómez', legalName: 'MG Distribución', country: 'AR', countries: ['AR'],
    contact: 'Telegram @mgtokens', priceFactor: 1.03, available: false, lots: [10_000],
    accounts: [
      { country: 'AR', currency: 'ARS', method: 'mercadopago', details: 'Mercado Pago alias: mg.tokens.mp' },
      { country: 'AR', currency: 'ARS', method: 'bank', details: 'CBU 0000000000000000000000 · alias mg.tokens' },
      { country: 'AR', currency: 'USD', method: 'usdt', details: 'USDT (TRC20) TXxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx' },
    ],
  },
  {
    email: 'dist.cl@fantasylive.test', name: 'Diego Soto', legalName: 'Diego Soto SpA', country: 'CL', countries: ['CL'],
    contact: 'WhatsApp +56 9 0000 0000', priceFactor: 0.99, available: true, lots: [5_000],
    accounts: [
      { country: 'CL', currency: 'CLP', method: 'bank', details: 'BancoEstado CuentaRUT 00000000 · RUT 00.000.000-0' },
      { country: 'CL', currency: 'CLP', method: 'mercadopago', details: 'Mercado Pago: diego.soto.mp' },
    ],
  },
  {
    email: 'dist.es@fantasylive.test', name: 'Lucía Martín', legalName: 'Lucía Martín Tokens', country: 'ES', countries: ['ES'],
    contact: 'Telegram @luciatokens', priceFactor: 0.96, available: true, lots: [10_000],
    accounts: [
      { country: 'ES', currency: 'EUR', method: 'bizum', details: 'Bizum 600 000 000 · Lucía Martín' },
      { country: 'ES', currency: 'EUR', method: 'bank', details: 'IBAN ES00 0000 0000 0000 0000 0000' },
    ],
  },
  {
    email: 'dist.us@fantasylive.test', name: 'Mike Johnson', legalName: 'MJ Tokens LLC', country: 'US', countries: ['US', 'PR'],
    contact: 'mj@example.com', priceFactor: 1, available: true, lots: [25_000, 100_000],
    accounts: [
      { country: 'US', currency: 'USD', method: 'cashapp', details: 'Cash App $mjtokens' },
      { country: 'US', currency: 'USD', method: 'venmo', details: 'Venmo @mj-tokens' },
      { country: 'US', currency: 'USD', method: 'zelle', details: 'Zelle mj@example.com' },
      { country: 'PR', currency: 'USD', method: 'paypal', details: 'PayPal mj@example.com' },
    ],
  },
  {
    email: 'dist.br@fantasylive.test', name: 'João Silva', legalName: 'JS Tokens Brasil', country: 'BR', countries: ['BR'],
    contact: 'WhatsApp +55 11 90000 0000', priceFactor: 0.95, available: true, lots: [10_000],
    accounts: [
      { country: 'BR', currency: 'BRL', method: 'pix', details: 'PIX chave: js.tokens@example.com' },
      { country: 'BR', currency: 'BRL', method: 'mercadopago', details: 'Mercado Pago: jstokens' },
    ],
  },
];

// Ana (MX) ya existe en las pruebas: se le añaden metodos de su pais si faltan.
const ANA_ACCOUNTS: Acc[] = [
  { country: 'MX', currency: 'MXN', method: 'oxxo', details: 'OXXO: tarjeta 0000 0000 0000 0000 · Ana Torres' },
  { country: 'MX', currency: 'MXN', method: 'spei', details: 'SPEI CLABE 000000000000000000 · Ana Torres' },
  { country: 'MX', currency: 'MXN', method: 'mercadopago', details: 'Mercado Pago: ana.torres.mp' },
];

const PACKAGES = [50, 100, 300, 500, 1000];

function niceRound(v: number) {
  // Precios "redondos" segun la magnitud (en unidades de la moneda).
  const step = v < 20 ? 0.5 : v < 200 ? 1 : v < 2_000 ? 5 : v < 20_000 ? 50 : v < 200_000 ? 500 : 1000;
  return Math.round(v / step) * step;
}

// --- Capturas de prueba (comprobantes) en el almacenamiento -----------------
const s3 =
  process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY
    ? new S3Client({
        region: process.env.S3_REGION || 'auto',
        endpoint: process.env.S3_ENDPOINT || undefined,
        forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? 'true') !== 'false',
        credentials: { accessKeyId: process.env.S3_ACCESS_KEY_ID, secretAccessKey: process.env.S3_SECRET_ACCESS_KEY },
        requestChecksumCalculation: 'WHEN_REQUIRED',
        responseChecksumValidation: 'WHEN_REQUIRED',
      })
    : null;
const BUCKET = process.env.S3_BUCKET || 'fantasylive-content';

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;');

/** "Captura" de un pago hecho desde la app del banco o de pago. */
function receiptSvg(o: { method: string; amount: string; ref: string; when: Date; to: string }) {
  const date = o.when.toLocaleString('es', { dateStyle: 'medium', timeStyle: 'short' });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="640" viewBox="0 0 390 640">
<rect width="390" height="640" fill="#f4f6f8"/>
<rect x="0" y="0" width="390" height="70" fill="#1f6feb"/>
<text x="24" y="44" font-family="Arial" font-size="20" fill="#fff" font-weight="bold">${esc(o.method)}</text>
<circle cx="195" cy="150" r="38" fill="#2ea043"/>
<path d="M176 151 l13 13 l26 -28" stroke="#fff" stroke-width="7" fill="none" stroke-linecap="round" stroke-linejoin="round"/>
<text x="195" y="225" font-family="Arial" font-size="18" fill="#333" text-anchor="middle">Pago enviado</text>
<text x="195" y="272" font-family="Arial" font-size="34" fill="#111" text-anchor="middle" font-weight="bold">${esc(o.amount)}</text>
<rect x="24" y="310" width="342" height="250" rx="14" fill="#fff"/>
<text x="44" y="350" font-family="Arial" font-size="13" fill="#888">Para</text>
<text x="44" y="372" font-family="Arial" font-size="14" fill="#222">${esc(o.to.slice(0, 40))}</text>
<text x="44" y="415" font-family="Arial" font-size="13" fill="#888">Fecha</text>
<text x="44" y="437" font-family="Arial" font-size="15" fill="#222">${esc(date)}</text>
<text x="44" y="480" font-family="Arial" font-size="13" fill="#888">Referencia</text>
<text x="44" y="502" font-family="Courier New" font-size="17" fill="#222">${esc(o.ref)}</text>
<text x="195" y="610" font-family="Arial" font-size="11" fill="#aaa" text-anchor="middle">Captura de prueba generada por el seed</text>
</svg>`;
}

/** "Captura" de los movimientos del distribuidor sin ese pago. */
function statementSvg(o: { method: string; when: Date; currency: string }) {
  const rows = [0, 1, 2, 3].map((i) => {
    const t = new Date(o.when.getTime() - (i + 1) * 47 * 60_000).toLocaleTimeString('es', { timeStyle: 'short' });
    const amt = (randInt(5, 90) * 10).toLocaleString('es');
    return `<text x="40" y="${200 + i * 60}" font-family="Arial" font-size="15" fill="#222">Recibido · ${t}</text>
<text x="350" y="${200 + i * 60}" font-family="Arial" font-size="15" fill="#2ea043" text-anchor="end">+${amt} ${esc(o.currency)}</text>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="390" height="520" viewBox="0 0 390 520">
<rect width="390" height="520" fill="#fff"/>
<rect width="390" height="70" fill="#6e40c9"/>
<text x="24" y="44" font-family="Arial" font-size="20" fill="#fff" font-weight="bold">${esc(o.method)} · Movimientos</text>
<text x="24" y="130" font-family="Arial" font-size="14" fill="#888">Hoy, ${esc(o.when.toLocaleDateString('es', { dateStyle: 'medium' }))}</text>
${rows.join('\n')}
<text x="195" y="470" font-family="Arial" font-size="13" fill="#c0392b" text-anchor="middle">No aparece ningún pago con esa referencia</text>
<text x="195" y="500" font-family="Arial" font-size="11" fill="#aaa" text-anchor="middle">Captura de prueba generada por el seed</text>
</svg>`;
}

async function uploadSvg(saleId: string, svg: string, prefix = 'distributor-proofs'): Promise<string | null> {
  if (!s3) return null;
  const key = `${prefix}/${saleId}/${randomUUID()}.svg`;
  try {
    await s3.send(new PutObjectCommand({ Bucket: BUCKET, Key: key, Body: Buffer.from(svg), ContentType: 'image/svg+xml' }));
    return key;
  } catch (e) {
    console.warn('[dist] no se pudo subir una captura de prueba:', (e as Error).message);
    return null;
  }
}

const METHOD_NAMES: Record<string, string> = {
  bank: 'Banco', nequi: 'Nequi', daviplata: 'Daviplata', pagomovil: 'Pago Móvil', binance: 'Binance Pay', zelle: 'Zelle',
  yape: 'Yape', plin: 'Plin', mercadopago: 'Mercado Pago', usdt: 'USDT', bizum: 'Bizum', cashapp: 'Cash App', venmo: 'Venmo',
  paypal: 'PayPal', pix: 'PIX', oxxo: 'OXXO', spei: 'SPEI',
};

const randInt = (a: number, b: number) => Math.floor(Math.random() * (b - a + 1)) + a;
const pick = <T,>(xs: T[]) => xs[Math.floor(Math.random() * xs.length)]!;
const daysAgo = (d: number) => new Date(Date.now() - d * 24 * 3600_000 - randInt(0, 12 * 3600_000));

async function rates(): Promise<Record<string, number>> {
  const row = await prisma.platformSetting.findUnique({ where: { key: 'fx_usd_rates' } }).catch(() => null);
  const v = (row?.value ?? null) as { rates?: Record<string, number> } | null;
  return { ...FALLBACK_RATES, ...(v?.rates ?? {}) };
}

async function addAccounts(distributorId: string, accounts: Acc[], priceFactor: number, fx: Record<string, number>) {
  const out = [];
  for (const a of accounts) {
    const rate = fx[a.currency] ?? 1;
    const acc = await prisma.distributorAccount.create({ data: { distributorId, ...a } });
    const pk = [];
    for (const t of PACKAGES) {
      const official = (t * TOKEN_VALUE_CENTS * rate) / 100; // en unidades
      const price = Math.max(0.5, niceRound(official * priceFactor));
      pk.push(await prisma.distributorPackage.create({ data: { accountId: acc.id, tokens: t, price: Math.round(price * 100) } }));
    }
    out.push({ acc, packages: pk, rate });
  }
  return out;
}

async function main() {
  const fx = await rates();
  const passwordHash = await bcrypt.hash(PASSWORD, 10);
  const admin = await prisma.user.findFirst({ where: { role: 'ADMIN' }, select: { id: true } });
  const fans = await prisma.user.findMany({
    where: { role: 'USER', modelProfile: null, distributor: null, ageVerified: true },
    select: { id: true, createdAt: true },
    take: 30,
  });
  if (fans.length === 0) throw new Error('No hay fans: ejecuta antes npm run db:seed');

  // Limpiar las cuentas de prueba anteriores (ventas primero: la cuenta de cobro es Restrict).
  const old = await prisma.user.findMany({ where: { email: { startsWith: 'dist.', endsWith: '@fantasylive.test' } }, select: { id: true } });
  if (old.length) {
    const ds = await prisma.distributor.findMany({ where: { userId: { in: old.map((u) => u.id) } }, select: { id: true } });
    await prisma.distributorSale.deleteMany({ where: { distributorId: { in: ds.map((d) => d.id) } } });
    await prisma.user.deleteMany({ where: { id: { in: old.map((u) => u.id) } } });
  }

  const now = new Date();
  for (const [idx, s] of SEEDS.entries()) {
    const user = await prisma.user.create({
      data: {
        email: s.email,
        name: s.name,
        username: s.email.split('@')[0]!.replace('.', '_'),
        passwordHash,
        role: 'USER',
        status: 'ACTIVE',
        emailVerified: now,
        ageVerified: true,
        birthDate: new Date('1990-01-01'),
        country: s.country,
        wallet: { create: { balance: 0 } },
      },
    });
    const d = await prisma.distributor.create({
      data: {
        userId: user.id,
        legalName: s.legalName,
        country: s.country,
        countries: s.countries,
        paymentMethods: [...new Set(s.accounts.map((a) => a.method))],
        publicContact: s.contact,
        dailyLimitTokens: 50_000,
        isAvailable: s.available,
        idVerifiedAt: now,
        sanctionsCheckedAt: now,
        contractSignedAt: now,
        notes: 'Distribuidor de prueba (scripts/seed-distributors.mts)',
      },
    });
    await seedHistory(d.id, s.lots, await addAccounts(d.id, s.accounts, s.priceFactor, fx), fans, admin?.id ?? null, idx);
    console.log(`[dist] ${s.legalName} (${s.countries.join(', ')}) · ${s.accounts.length} métodos`);
  }

  const ana = await prisma.distributor.findFirst({ where: { user: { email: 'ana@fantasylive.test' } }, include: { accounts: true } });
  if (ana) {
    const missing = ANA_ACCOUNTS.filter((a) => !ana.accounts.some((x) => x.active && x.method === a.method && x.country === a.country));
    await addAccounts(ana.id, missing, 0.98, fx);
    await prisma.distributor.update({
      where: { id: ana.id },
      data: { paymentMethods: [...new Set([...ana.paymentMethods, ...ANA_ACCOUNTS.map((a) => a.method)])] },
    });
    console.log(`[dist] Ana Torres (MX) · +${missing.length} métodos`);
  }
  console.log('Listo. Contraseña de las cuentas dist.*:', PASSWORD === 'Password123!' ? 'la del seed' : '(SEED_PASSWORD)');
}

/** Recibo de prueba del pago de un lote (transferencia o USDT). */
async function attachLotReceipt(orderId: string, method: 'WIRE' | 'USDT', amountCents: number, ref: string, when: Date) {
  const key = await uploadSvg(
    orderId,
    receiptSvg({
      method: method === 'USDT' ? 'USDT (TRC20)' : 'Transferencia bancaria',
      amount: `${(amountCents / 100).toLocaleString('es', { minimumFractionDigits: 2 })} USD`,
      ref,
      when,
      to: 'FantasyLive (cuenta de la empresa)',
    }),
    'distributor-lots',
  );
  if (key) await prisma.distributorOrder.update({ where: { id: orderId }, data: { proofKey: key } });
}

/** Lotes pagados y ventas a fans de los ultimos 30 dias (sin tocar saldos). */
async function seedHistory(
  distributorId: string,
  lots: number[],
  accounts: { acc: { id: string; currency: string; method: string; details: string }; packages: { id: string; tokens: number; price: number }[]; rate: number }[],
  fans: { id: string; createdAt: Date }[],
  adminId: string | null,
  idx: number,
) {
  let stock = 0;
  for (const [i, tokens] of lots.entries()) {
    const pct = discountFor(tokens);
    const amountCents = Math.round(tokens * TOKEN_VALUE_CENTS * (1 - pct / 100));
    const at = daysAgo(Math.max(2, 29 - i * 9));
    const method = i % 2 ? 'USDT' : 'WIRE';
    const ref = method === 'USDT' ? `0x${randomUUID().replace(/-/g, '').slice(0, 24)}` : `WIRE-${randInt(100000, 999999)}`;
    const o = await prisma.distributorOrder.create({
      data: {
        distributorId, tokens, discountPercent: pct, amountCents,
        centsPerToken: Math.round((amountCents * 1000) / tokens),
        paymentMethod: method, status: 'PAID', paymentRef: ref,
        confirmedById: adminId, paidAt: at, createdAt: new Date(at.getTime() - 3 * 3600_000),
        proofUploadedAt: new Date(at.getTime() - 3600_000),
      },
    });
    await attachLotReceipt(o.id, method, amountCents, ref, at);
    stock += tokens;
  }
  // Lotes pendientes: los 2 primeros ya enviaron recibo, el 3.º y 4.º aún no han pagado.
  if (idx < 4) {
    const tokens = pick([5_000, 10_000, 25_000]);
    const pct = discountFor(tokens);
    const amountCents = Math.round(tokens * TOKEN_VALUE_CENTS * (1 - pct / 100));
    const o = await prisma.distributorOrder.create({
      data: { distributorId, tokens, discountPercent: pct, amountCents, centsPerToken: Math.round((amountCents * 1000) / tokens), status: 'PENDING', createdAt: daysAgo(1) },
    });
    if (idx < 2) {
      const ref = `WIRE-${randInt(100000, 999999)}`;
      await prisma.distributorOrder.update({ where: { id: o.id }, data: { paymentRef: ref, proofUploadedAt: new Date() } });
      await attachLotReceipt(o.id, 'WIRE', amountCents, ref, new Date());
    }
  }

  // Cada distribuidor tiene sus clientes habituales (pocos fans).
  const myFans = [...fans].sort(() => Math.random() - 0.5).slice(0, randInt(2, 4));
  const nSales = randInt(8, 30);
  for (let i = 0; i < nSales; i++) {
    const { acc, packages, rate } = pick(accounts);
    const p = pick(packages.slice(0, 4));
    if (p.tokens > stock) continue;
    const fan = pick(myFans);
    // Nunca antes de que exista la cuenta del fan (+1 dia).
    const created = new Date(Math.max(daysAgo(Math.random() * 30).getTime(), fan.createdAt.getTime() + 24 * 3600_000 + randInt(0, 3600_000)));
    if (created > new Date()) continue;
    const roll = Math.random();
    const status = roll < 0.76 ? 'COMPLETED' : roll < 0.92 ? 'CANCELLED' : roll < 0.95 ? 'DISPUTED' : 'PAID';
    const disputeBy = pick(['FAN', 'DISTRIBUTOR']);
    const paidAt = status === 'CANCELLED' ? null : new Date(created.getTime() + randInt(3, 25) * 60_000);
    const completedAt = status === 'COMPLETED' && paidAt ? new Date(paidAt.getTime() + randInt(2, 90) * 60_000) : null;
    const sale = await prisma.distributorSale.create({
      data: {
        distributorId, fanId: fan.id, accountId: acc.id, packageId: p.id, tokens: p.tokens, currency: acc.currency,
        amount: p.price, referenceAmount: Math.round(p.tokens * TOKEN_VALUE_CENTS * rate),
        status, expiresAt: new Date(created.getTime() + 30 * 60_000), createdAt: created,
        paymentRef: paidAt ? `REF${randInt(10000, 99999)}` : null,
        paidAt, completedAt,
        cancelledAt: status === 'CANCELLED' ? new Date(created.getTime() + 30 * 60_000) : null,
        cancelReason: status === 'CANCELLED' ? pick(['No se pagó a tiempo', 'No se pagó a tiempo', 'Cancelado por el fan']) : null,
        disputedAt: status === 'DISPUTED' ? new Date(created.getTime() + 60 * 60_000) : null,
        disputeBy: status === 'DISPUTED' ? disputeBy : null,
        disputeReason: status === 'DISPUTED' ? (disputeBy === 'FAN' ? 'Pagué y no me llegan los tokens' : 'No me llegó el pago') : null,
        rating: status === 'COMPLETED' && Math.random() < 0.6 ? (Math.random() < 0.9 ? 1 : -1) : null,
        // Algunas completadas vienen de una disputa ya resuelta por el equipo.
        ...(status === 'COMPLETED' && Math.random() < 0.07
          ? {
              disputeBy: 'DISTRIBUTOR',
              disputeReason: 'No me llegó el pago',
              disputedAt: paidAt,
              resolvedById: adminId,
              resolvedAt: completedAt,
              resolutionNote: 'El comprobante del fan coincide con la referencia y el importe: el pago sí se hizo.',
            }
          : {}),
      },
    });
    // Comprobante del fan (cuando marco "Ya pagué") y prueba de la disputa.
    if (paidAt) {
      const accData = acc;
      const methodName = METHOD_NAMES[accData.method] ?? 'Pago';
      const amountTxt = `${(p.price / 100).toLocaleString('es')} ${acc.currency}`;
      const proofKey = await uploadSvg(sale.id, receiptSvg({ method: methodName, amount: amountTxt, ref: sale.paymentRef ?? '', when: paidAt, to: accData.details }));
      let evidenceKey: string | null = null;
      if (status === 'DISPUTED') {
        evidenceKey = await uploadSvg(
          sale.id,
          disputeBy === 'DISTRIBUTOR'
            ? statementSvg({ method: methodName, when: paidAt, currency: acc.currency })
            : receiptSvg({ method: `${methodName} · Detalle`, amount: amountTxt, ref: sale.paymentRef ?? '', when: paidAt, to: accData.details }),
        );
      }
      if (proofKey || evidenceKey) {
        await prisma.distributorSale.update({ where: { id: sale.id }, data: { paymentProofKey: proofKey, disputeEvidenceKey: evidenceKey } });
      }
    }
    if (status === 'COMPLETED') {
      await prisma.distributorTransfer.create({ data: { distributorId, toUserId: fan.id, tokens: p.tokens, saleId: sale.id, createdAt: completedAt! } });
    }
    if (status !== 'CANCELLED') stock -= p.tokens;
  }
  await prisma.distributor.update({ where: { id: distributorId }, data: { stockTokens: Math.max(0, stock) } });
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
