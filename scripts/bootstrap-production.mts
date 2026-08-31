/* eslint-disable no-console */
/**
 * Bootstrap de PRODUCCION
 * ---------------------------------------------------------------------------
 * Deja la base de datos lista para operar sin sembrar NADA ficticio.
 *
 * A diferencia de `prisma/seed.ts` (que empieza borrando todas las tablas y
 * crea usuarios de prueba con una contrasena conocida), este script:
 *   - es idempotente: se puede reejecutar en cada despliegue;
 *   - no borra ni sobreescribe datos existentes;
 *   - crea un unico administrador, con credenciales que se pasan por entorno.
 *
 * Uso:
 *   ADMIN_EMAIL=tu@correo.com ADMIN_PASSWORD='...' npx tsx scripts/bootstrap-production.mts
 */

import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const TOKEN_PACKAGES = [
  { sku: 'starter-100', name: 'Starter', tokens: 100, bonus: 0, cents: 999, popular: false, desc: 'Ideal para probar la plataforma' },
  { sku: 'basic-300', name: 'Basic', tokens: 300, bonus: 25, cents: 2799, popular: false, desc: '25 tokens de regalo' },
  { sku: 'popular-750', name: 'Popular', tokens: 750, bonus: 100, cents: 5999, popular: true, desc: 'El mas elegido: 100 tokens extra' },
  { sku: 'premium-1600', name: 'Premium', tokens: 1600, bonus: 300, cents: 11999, popular: false, desc: '300 tokens extra + acceso anticipado' },
  { sku: 'whale-4000', name: 'Elite', tokens: 4000, bonus: 1000, cents: 27999, popular: false, desc: '1000 tokens extra + soporte prioritario' },
];

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`[bootstrap] Falta la variable ${name}.`);
    process.exit(1);
  }
  return value;
}

function assertStrongPassword(password: string) {
  const problems: string[] = [];
  if (password.length < 12) problems.push('al menos 12 caracteres');
  if (!/[a-z]/.test(password)) problems.push('una minuscula');
  if (!/[A-Z]/.test(password)) problems.push('una mayuscula');
  if (!/[0-9]/.test(password)) problems.push('un numero');
  if (!/[^A-Za-z0-9]/.test(password)) problems.push('un simbolo');

  if (problems.length > 0) {
    console.error(
      `[bootstrap] ADMIN_PASSWORD demasiado debil: falta ${problems.join(', ')}.`,
    );
    process.exit(1);
  }
}

async function main() {
  const adminEmail = requireEnv('ADMIN_EMAIL').toLowerCase().trim();
  const adminPassword = requireEnv('ADMIN_PASSWORD');
  assertStrongPassword(adminPassword);

  const commission = Number(process.env.PLATFORM_COMMISSION_PERCENT ?? 50);
  const minPayout = Number(process.env.MIN_PAYOUT_TOKENS ?? 500);

  console.log('[bootstrap] Ajustes de plataforma...');
  const settings = [
    { key: 'commission_percent', value: commission, description: 'Comision de la plataforma sobre tokens gastados' },
    { key: 'min_payout_tokens', value: minPayout, description: 'Minimo de tokens para solicitar retiro' },
    { key: 'random_call_rate', value: 0, description: 'Tokens/min en llamadas aleatorias normales' },
    { key: 'maintenance_mode', value: false, description: 'Modo mantenimiento global' },
    { key: 'require_kyc_to_stream', value: true, description: 'Exige KYC aprobado para emitir' },
  ];
  for (const setting of settings) {
    await prisma.platformSetting.upsert({
      where: { key: setting.key },
      create: setting,
      update: { value: setting.value, description: setting.description },
    });
  }

  console.log('[bootstrap] Paquetes de tokens...');
  for (const [i, p] of TOKEN_PACKAGES.entries()) {
    await prisma.tokenPackage.upsert({
      where: { sku: p.sku },
      create: {
        sku: p.sku,
        name: p.name,
        description: p.desc,
        tokens: p.tokens,
        bonusTokens: p.bonus,
        priceCents: p.cents,
        currency: 'USD',
        isPopular: p.popular,
        sortOrder: i,
      },
      // No se pisa el precio si el operador ya lo ajusto a mano.
      update: { name: p.name, description: p.desc, sortOrder: i },
    });
  }

  console.log('[bootstrap] Administrador...');
  const passwordHash = await bcrypt.hash(adminPassword, 12);
  const admin = await prisma.user.upsert({
    where: { email: adminEmail },
    create: {
      email: adminEmail,
      name: 'Administrador',
      username: 'admin',
      passwordHash,
      role: 'ADMIN',
      status: 'ACTIVE',
      emailVerified: new Date(),
      ageVerified: true,
      wallet: { create: {} },
    },
    // Reejecutar el bootstrap restablece la contrasena del admin y su rol,
    // que es justo lo que se quiere para recuperar el acceso.
    update: { passwordHash, role: 'ADMIN', status: 'ACTIVE' },
    select: { id: true, email: true },
  });
  await prisma.wallet.upsert({
    where: { userId: admin.id },
    create: { userId: admin.id },
    update: {},
  });

  const [users, models, packages] = await Promise.all([
    prisma.user.count(),
    prisma.modelProfile.count(),
    prisma.tokenPackage.count(),
  ]);

  console.log('\n[bootstrap] Listo.');
  console.log(`  admin:            ${admin.email}`);
  console.log(`  usuarios:         ${users}`);
  console.log(`  modelos:          ${models}`);
  console.log(`  packs de tokens:  ${packages}`);
  console.log(`  comision:         ${commission}% plataforma / ${100 - commission}% modelo`);
}

main()
  .catch((error) => {
    console.error('[bootstrap] Error:', error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
