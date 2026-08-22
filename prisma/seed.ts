/* eslint-disable no-console */
/**
 * Seed de FantasyLive
 * ---------------------------------------------------------------------------
 * Puebla la base de datos local con datos ficticios listos para probar TODA la
 * aplicacion: admin, usuarios, modelos de distintos generos y orientaciones,
 * monederos con saldo, paquetes de contenido, historial de llamadas, reservas,
 * KYC en varios estados, payouts y reportes.
 *
 * Ejecutar:  npm run db:seed
 * Reset:     npm run db:reset  (borra + migra + siembra)
 */

import {
  BookingStatus,
  CallEndReason,
  CallStatus,
  CallType,
  ContentType,
  DocumentType,
  Gender,
  KycStatus,
  ModelTier,
  Orientation,
  PayoutMethod,
  PayoutStatus,
  PrismaClient,
  ReportReason,
  ReportStatus,
  Role,
  TransactionType,
  UserStatus,
} from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

const SEED_PASSWORD = process.env.SEED_PASSWORD || 'Password123!';
const COMMISSION = Number(process.env.PLATFORM_COMMISSION_PERCENT ?? 30);

// ---------------------------------------------------------------------------
// Utilidades
// ---------------------------------------------------------------------------

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function pickMany<T>(arr: readonly T[], count: number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < count && copy.length; i++) {
    out.push(copy.splice(Math.floor(Math.random() * copy.length), 1)[0]!);
  }
  return out;
}

function randInt(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function hoursFromNow(hours: number): Date {
  return new Date(Date.now() + hours * 60 * 60 * 1000);
}

function birthDateForAge(age: number): Date {
  const d = new Date();
  d.setFullYear(d.getFullYear() - age);
  d.setMonth(randInt(0, 11));
  d.setDate(randInt(1, 28));
  return d;
}

function slugify(s: string): string {
  return s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const avatar = (seed: string) => `https://i.pravatar.cc/400?u=${seed}`;
const cover = (seed: string) => `https://picsum.photos/seed/${seed}/1200/500`;
const photo = (seed: string) => `https://picsum.photos/seed/${seed}/800/1000`;

// ---------------------------------------------------------------------------
// Catalogo de modelos ficticios (multi-genero y multi-orientacion)
// ---------------------------------------------------------------------------

interface ModelSeed {
  email: string;
  name: string;
  stageName: string;
  gender: Gender;
  orientation: Orientation;
  tier: ModelTier;
  country: string;
  age: number;
  headline: string;
  bio: string;
  languages: string[];
  tags: string[];
  vipRate: number;
  privateRate: number;
  isOnline: boolean;
  vipEnabled: boolean;
  kyc: KycStatus;
}

const MODEL_SEEDS: ModelSeed[] = [
  {
    email: 'valentina@fantasylive.test',
    name: 'Valentina Rojas',
    stageName: 'ValentinaVIP',
    gender: Gender.FEMALE,
    orientation: Orientation.BISEXUAL,
    tier: ModelTier.ELITE,
    country: 'Colombia',
    age: 27,
    headline: 'Show privado con mucha conversacion y complicidad',
    bio: 'Bailarina y creadora de contenido. Me encanta conocer gente nueva y crear experiencias personalizadas. Habla conmigo antes del show.',
    languages: ['Espanol', 'Ingles'],
    tags: ['latina', 'curvy', 'tatuajes', 'roleplay'],
    vipRate: 45,
    privateRate: 90,
    isOnline: true,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'sofia@fantasylive.test',
    name: 'Sofia Marchetti',
    stageName: 'SofiaLuxe',
    gender: Gender.FEMALE,
    orientation: Orientation.STRAIGHT,
    tier: ModelTier.VIP,
    country: 'Italia',
    age: 24,
    headline: 'Italiana dulce, conversacion lenta y mucha atencion',
    bio: 'Me gusta lo intimo y sin prisas. Sesiones privadas con foco total en ti.',
    languages: ['Italiano', 'Ingles', 'Espanol'],
    tags: ['europea', 'rubia', 'fitness'],
    vipRate: 35,
    privateRate: 70,
    isOnline: true,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'lucia@fantasylive.test',
    name: 'Lucia Fernandez',
    stageName: 'LuciaWild',
    gender: Gender.FEMALE,
    orientation: Orientation.LESBIAN,
    tier: ModelTier.VIP,
    country: 'Espana',
    age: 29,
    headline: 'Domina experimentada, sesiones guiadas',
    bio: 'Sesiones de rol y dominacion suave. Escribeme tus limites antes de empezar y los respetamos.',
    languages: ['Espanol', 'Ingles'],
    tags: ['domina', 'morena', 'fetiche', 'piercing'],
    vipRate: 50,
    privateRate: 100,
    isOnline: false,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'mateo@fantasylive.test',
    name: 'Mateo Silva',
    stageName: 'MateoFit',
    gender: Gender.MALE,
    orientation: Orientation.GAY,
    tier: ModelTier.VIP,
    country: 'Brasil',
    age: 26,
    headline: 'Entrenador personal, shows energeticos',
    bio: 'Brasileno, fitness y buen rollo. Sesiones divertidas y sin postureo.',
    languages: ['Portugues', 'Espanol', 'Ingles'],
    tags: ['fitness', 'tatuajes', 'moreno'],
    vipRate: 30,
    privateRate: 60,
    isOnline: true,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'adrian@fantasylive.test',
    name: 'Adrian Kovacs',
    stageName: 'AdrianNight',
    gender: Gender.MALE,
    orientation: Orientation.BISEXUAL,
    tier: ModelTier.STANDARD,
    country: 'Hungria',
    age: 31,
    headline: 'Conversacion, musica y buena compania',
    bio: 'Musico de noche, modelo de dia. Me gusta charlar tanto como el show.',
    languages: ['Ingles', 'Aleman'],
    tags: ['europea', 'gamer', 'tatuajes'],
    vipRate: 22,
    privateRate: 45,
    isOnline: false,
    vipEnabled: false,
    kyc: KycStatus.PENDING,
  },
  {
    email: 'nina@fantasylive.test',
    name: 'Nina Petrova',
    stageName: 'NinaTrans',
    gender: Gender.TRANS_FEMALE,
    orientation: Orientation.PANSEXUAL,
    tier: ModelTier.VIP,
    country: 'Ucrania',
    age: 25,
    headline: 'Trans femenina, ambiente relajado y respetuoso',
    bio: 'Espacio seguro, sin juicios. Cosplay y roleplay a medida.',
    languages: ['Ruso', 'Ingles'],
    tags: ['cosplay', 'pelirroja', 'roleplay'],
    vipRate: 38,
    privateRate: 75,
    isOnline: true,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'kai@fantasylive.test',
    name: 'Kai Nakamura',
    stageName: 'KaiNonBinary',
    gender: Gender.NON_BINARY,
    orientation: Orientation.QUEER,
    tier: ModelTier.STANDARD,
    country: 'Japon',
    age: 23,
    headline: 'Arte, cosplay y charlas nocturnas',
    bio: 'Ilustrador/a y streamer. Cosplay a peticion y sesiones creativas.',
    languages: ['Ingles', 'Espanol'],
    tags: ['asiatica', 'cosplay', 'gamer'],
    vipRate: 25,
    privateRate: 50,
    isOnline: true,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'camila@fantasylive.test',
    name: 'Camila Duarte',
    stageName: 'CamilaMilf',
    gender: Gender.FEMALE,
    orientation: Orientation.STRAIGHT,
    tier: ModelTier.STANDARD,
    country: 'Argentina',
    age: 38,
    headline: 'Experiencia, calma y conversacion adulta',
    bio: 'Nada de prisas. Me gusta escuchar y que la sesion fluya.',
    languages: ['Espanol'],
    tags: ['milf', 'latina', 'morena'],
    vipRate: 28,
    privateRate: 55,
    isOnline: false,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'jules@fantasylive.test',
    name: 'Jules Moreau',
    stageName: 'JulesAndSam',
    gender: Gender.COUPLE,
    orientation: Orientation.BISEXUAL,
    tier: ModelTier.VIP,
    country: 'Francia',
    age: 30,
    headline: 'Pareja real, shows compartidos',
    bio: 'Somos pareja en la vida real. Sesiones para uno o para dos.',
    languages: ['Frances', 'Ingles'],
    tags: ['pareja', 'europea', 'fitness'],
    vipRate: 60,
    privateRate: 120,
    isOnline: true,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'thiago@fantasylive.test',
    name: 'Thiago Reyes',
    stageName: 'ThiagoTransMasc',
    gender: Gender.TRANS_MALE,
    orientation: Orientation.QUEER,
    tier: ModelTier.STANDARD,
    country: 'Mexico',
    age: 28,
    headline: 'Trans masculino, charla honesta y buen humor',
    bio: 'Sesiones autenticas y sin guion. Comunidad queer bienvenida.',
    languages: ['Espanol', 'Ingles'],
    tags: ['latina', 'tatuajes', 'fitness'],
    vipRate: 26,
    privateRate: 52,
    isOnline: false,
    vipEnabled: false,
    kyc: KycStatus.REJECTED,
  },
  {
    email: 'yasmin@fantasylive.test',
    name: 'Yasmin Haddad',
    stageName: 'YasminSilk',
    gender: Gender.FEMALE,
    orientation: Orientation.BISEXUAL,
    tier: ModelTier.VIP,
    country: 'Marruecos',
    age: 26,
    headline: 'Danza, seduccion lenta y mucha mirada',
    bio: 'Bailarina profesional. Las sesiones empiezan siempre con musica.',
    languages: ['Frances', 'Ingles', 'Espanol'],
    tags: ['morena', 'curvy', 'roleplay'],
    vipRate: 40,
    privateRate: 80,
    isOnline: true,
    vipEnabled: true,
    kyc: KycStatus.APPROVED,
  },
  {
    email: 'erik@fantasylive.test',
    name: 'Erik Lindqvist',
    stageName: 'ErikNordic',
    gender: Gender.MALE,
    orientation: Orientation.STRAIGHT,
    tier: ModelTier.STANDARD,
    country: 'Suecia',
    age: 33,
    headline: 'Nordico tranquilo, conversacion profunda',
    bio: 'Prefiero calidad a cantidad. Pocas sesiones, muy cuidadas.',
    languages: ['Ingles', 'Aleman'],
    tags: ['europea', 'rubio', 'fitness'],
    vipRate: 24,
    privateRate: 48,
    isOnline: false,
    vipEnabled: true,
    kyc: KycStatus.NOT_SUBMITTED,
  },
];

const USER_SEEDS = [
  { email: 'usuario@fantasylive.test', name: 'Carlos Mendez', gender: Gender.MALE, orientation: Orientation.STRAIGHT, country: 'Espana', tokens: 1250, vip: true },
  { email: 'ana@fantasylive.test', name: 'Ana Torres', gender: Gender.FEMALE, orientation: Orientation.BISEXUAL, country: 'Mexico', tokens: 480, vip: false },
  { email: 'diego@fantasylive.test', name: 'Diego Ramirez', gender: Gender.MALE, orientation: Orientation.GAY, country: 'Argentina', tokens: 3200, vip: true },
  { email: 'laura@fantasylive.test', name: 'Laura Blanco', gender: Gender.FEMALE, orientation: Orientation.LESBIAN, country: 'Chile', tokens: 90, vip: false },
  { email: 'sam@fantasylive.test', name: 'Sam Oyelaran', gender: Gender.NON_BINARY, orientation: Orientation.PANSEXUAL, country: 'Reino Unido', tokens: 660, vip: false },
  { email: 'marco@fantasylive.test', name: 'Marco Ferrari', gender: Gender.MALE, orientation: Orientation.BISEXUAL, country: 'Italia', tokens: 15, vip: false },
  { email: 'nuria@fantasylive.test', name: 'Nuria Sanz', gender: Gender.FEMALE, orientation: Orientation.STRAIGHT, country: 'Espana', tokens: 2100, vip: true },
  { email: 'tom@fantasylive.test', name: 'Tom Becker', gender: Gender.MALE, orientation: Orientation.STRAIGHT, country: 'Alemania', tokens: 0, vip: false },
];

const TOKEN_PACKAGES = [
  { sku: 'starter-100', name: 'Starter', tokens: 100, bonus: 0, cents: 999, popular: false, desc: 'Ideal para probar la plataforma' },
  { sku: 'basic-300', name: 'Basic', tokens: 300, bonus: 25, cents: 2799, popular: false, desc: '25 tokens de regalo' },
  { sku: 'popular-750', name: 'Popular', tokens: 750, bonus: 100, cents: 5999, popular: true, desc: 'El mas elegido: 100 tokens extra' },
  { sku: 'premium-1600', name: 'Premium', tokens: 1600, bonus: 300, cents: 11999, popular: false, desc: '300 tokens extra + acceso anticipado' },
  { sku: 'whale-4000', name: 'Elite', tokens: 4000, bonus: 1000, cents: 27999, popular: false, desc: '1000 tokens extra + soporte prioritario' },
];

const CONTENT_TEMPLATES = [
  { title: 'Sesion de fotos en estudio', type: ContentType.PHOTO, price: 45 },
  { title: 'Backstage exclusivo', type: ContentType.PHOTO, price: 30 },
  { title: 'Video personalizado 5 min', type: ContentType.VIDEO, price: 120 },
  { title: 'Pack completo del mes', type: ContentType.BUNDLE, price: 250 },
  { title: 'Galeria de bienvenida', type: ContentType.PHOTO, price: 0 },
  { title: 'Show grabado en directo', type: ContentType.VIDEO, price: 180 },
];

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n[seed] Limpiando datos previos...');

  // Orden inverso a las dependencias
  await prisma.auditLog.deleteMany();
  await prisma.report.deleteMany();
  await prisma.callBillingTick.deleteMany();
  await prisma.transaction.deleteMany();
  await prisma.gift.deleteMany();
  await prisma.matchQueueEntry.deleteMany();
  await prisma.callSession.deleteMany();
  await prisma.booking.deleteMany();
  await prisma.contentUnlock.deleteMany();
  await prisma.contentAsset.deleteMany();
  await prisma.contentPackage.deleteMany();
  await prisma.availabilitySlot.deleteMany();
  await prisma.review.deleteMany();
  await prisma.payoutRequest.deleteMany();
  await prisma.kycVerification.deleteMany();
  await prisma.blockedPair.deleteMany();
  await prisma.modelProfile.deleteMany();
  await prisma.wallet.deleteMany();
  await prisma.session.deleteMany();
  await prisma.account.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tokenPackage.deleteMany();
  await prisma.platformSetting.deleteMany();

  const passwordHash = await bcrypt.hash(SEED_PASSWORD, 10);

  // -------------------------------------------------------------------------
  // 1. Ajustes de plataforma
  // -------------------------------------------------------------------------
  console.log('[seed] Ajustes de plataforma...');
  await prisma.platformSetting.createMany({
    data: [
      { key: 'commission_percent', value: COMMISSION, description: 'Comision de la plataforma sobre tokens gastados' },
      { key: 'min_payout_tokens', value: 500, description: 'Minimo de tokens para solicitar retiro' },
      { key: 'random_call_rate', value: 0, description: 'Tokens/min en llamadas aleatorias normales' },
      { key: 'maintenance_mode', value: false, description: 'Modo mantenimiento global' },
      { key: 'require_kyc_to_stream', value: true, description: 'Exige KYC aprobado para emitir' },
    ],
  });

  // -------------------------------------------------------------------------
  // 2. Paquetes de tokens
  // -------------------------------------------------------------------------
  console.log('[seed] Paquetes de tokens...');
  const packages = await Promise.all(
    TOKEN_PACKAGES.map((p, i) =>
      prisma.tokenPackage.create({
        data: {
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
      }),
    ),
  );

  // -------------------------------------------------------------------------
  // 3. Admin
  // -------------------------------------------------------------------------
  console.log('[seed] Administrador...');
  const admin = await prisma.user.create({
    data: {
      email: 'admin@fantasylive.test',
      name: 'Admin FantasyLive',
      username: 'admin',
      passwordHash,
      role: Role.ADMIN,
      status: UserStatus.ACTIVE,
      emailVerified: new Date(),
      ageVerified: true,
      birthDate: birthDateForAge(35),
      country: 'Espana',
      image: avatar('admin'),
      wallet: { create: { balance: 100000, lifetimePurchased: 100000 } },
    },
  });

  // -------------------------------------------------------------------------
  // 4. Usuarios
  // -------------------------------------------------------------------------
  console.log('[seed] Usuarios...');
  const users = [];
  for (const u of USER_SEEDS) {
    const user = await prisma.user.create({
      data: {
        email: u.email,
        name: u.name,
        username: slugify(u.name),
        passwordHash,
        role: Role.USER,
        status: UserStatus.ACTIVE,
        emailVerified: new Date(),
        ageVerified: true,
        birthDate: birthDateForAge(randInt(21, 45)),
        gender: u.gender,
        orientation: u.orientation,
        country: u.country,
        isVip: u.vip,
        vipUntil: u.vip ? hoursFromNow(24 * 30) : null,
        image: avatar(u.email),
        lastSeenAt: daysAgo(Math.random() * 3),
        languages: pickMany(['Espanol', 'Ingles', 'Frances', 'Portugues'], randInt(1, 2)),
        wallet: {
          create: {
            balance: u.tokens,
            lifetimePurchased: u.tokens + randInt(0, 2000),
            lifetimeSpent: randInt(0, 1800),
          },
        },
      },
    });
    users.push(user);

    // Historial de compras
    if (u.tokens > 0) {
      const pkg = pick(packages);
      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.TOKEN_PURCHASE,
          tokens: pkg.tokens + pkg.bonusTokens,
          balanceAfter: u.tokens,
          amountCents: pkg.priceCents,
          currency: 'USD',
          provider: 'STRIPE',
          providerRef: `seed_pi_${user.id}`,
          description: `Compra ${pkg.name}`,
          tokenPackageId: pkg.id,
          createdAt: daysAgo(randInt(1, 40)),
        },
      });
    }

    await prisma.transaction.create({
      data: {
        userId: user.id,
        type: TransactionType.SIGNUP_BONUS,
        tokens: 25,
        balanceAfter: 25,
        description: 'Bono de bienvenida',
        createdAt: daysAgo(randInt(40, 90)),
      },
    });
  }

  // Un usuario suspendido y uno baneado, para probar el panel admin
  const suspended = await prisma.user.create({
    data: {
      email: 'suspendido@fantasylive.test',
      name: 'Ivan Suspendido',
      username: 'ivan-suspendido',
      passwordHash,
      role: Role.USER,
      status: UserStatus.SUSPENDED,
      suspendedUntil: hoursFromNow(72),
      banReason: 'Comportamiento inadecuado en llamada aleatoria',
      ageVerified: true,
      birthDate: birthDateForAge(30),
      gender: Gender.MALE,
      country: 'Peru',
      image: avatar('suspendido'),
      wallet: { create: { balance: 40 } },
    },
  });

  const banned = await prisma.user.create({
    data: {
      email: 'baneado@fantasylive.test',
      name: 'Usuario Baneado',
      username: 'usuario-baneado',
      passwordHash,
      role: Role.USER,
      status: UserStatus.BANNED,
      banReason: 'Intento de fraude con tarjeta',
      ageVerified: true,
      birthDate: birthDateForAge(27),
      gender: Gender.MALE,
      country: 'Desconocido',
      image: avatar('baneado'),
      wallet: { create: { balance: 0 } },
    },
  });

  // -------------------------------------------------------------------------
  // 5. Modelos + perfiles + contenido + disponibilidad + KYC
  // -------------------------------------------------------------------------
  console.log('[seed] Modelos, contenido y KYC...');
  const models = [];

  for (const m of MODEL_SEEDS) {
    const earned = randInt(2000, 45000);

    const user = await prisma.user.create({
      data: {
        email: m.email,
        name: m.name,
        username: slugify(m.stageName),
        passwordHash,
        role: Role.MODEL,
        status: UserStatus.ACTIVE,
        emailVerified: new Date(),
        ageVerified: m.kyc === KycStatus.APPROVED,
        birthDate: birthDateForAge(m.age),
        gender: m.gender,
        orientation: m.orientation,
        country: m.country,
        languages: m.languages,
        image: avatar(m.email),
        lastSeenAt: m.isOnline ? new Date() : daysAgo(randInt(1, 5)),
        wallet: {
          create: {
            balance: Math.round(earned * 0.35),
            pendingEarnings: Math.round(earned * 0.35),
            lifetimeEarned: earned,
            lifetimeWithdrawn: Math.round(earned * 0.6),
          },
        },
      },
    });

    const profile = await prisma.modelProfile.create({
      data: {
        userId: user.id,
        stageName: m.stageName,
        slug: slugify(m.stageName),
        headline: m.headline,
        bio: m.bio,
        gender: m.gender,
        orientation: m.orientation,
        tier: m.tier,
        birthYear: new Date().getFullYear() - m.age,
        country: m.country,
        languages: m.languages,
        tags: m.tags,
        avatarUrl: avatar(m.email),
        coverUrl: cover(m.stageName),
        vipRatePerMinute: m.vipRate,
        privateRatePerMinute: m.privateRate,
        minPrivateMinutes: pick([10, 15, 20]),
        isVipEnabled: m.vipEnabled && m.kyc === KycStatus.APPROVED,
        acceptsBookings: m.kyc === KycStatus.APPROVED,
        isOnline: m.isOnline,
        isAvailableForVip: m.isOnline && m.vipEnabled && m.kyc === KycStatus.APPROVED,
        lastOnlineAt: m.isOnline ? new Date() : daysAgo(randInt(1, 5)),
        ratingAvg: Number((Math.random() * 1.5 + 3.5).toFixed(2)),
        ratingCount: randInt(8, 340),
        totalCalls: randInt(20, 900),
        totalMinutes: randInt(200, 12000),
        totalTokensEarned: earned,
        followersCount: randInt(50, 8000),
        kycStatus: m.kyc,
      },
    });

    models.push({ user, profile, seed: m });

    // --- Disponibilidad semanal (agenda) ---
    const weekdays = pickMany([0, 1, 2, 3, 4, 5, 6], randInt(3, 6));
    for (const wd of weekdays) {
      const start = randInt(14, 21) * 60; // entre 14:00 y 21:00
      await prisma.availabilitySlot.create({
        data: {
          modelId: profile.id,
          weekday: wd,
          startMinute: start,
          endMinute: Math.min(start + randInt(120, 300), 24 * 60 - 1),
          timezone: 'UTC',
        },
      });
    }

    // --- Paquetes de contenido ---
    const templates = pickMany(CONTENT_TEMPLATES, randInt(2, 4));
    for (const [idx, t] of templates.entries()) {
      const assetCount = t.type === ContentType.VIDEO ? randInt(1, 3) : randInt(4, 12);
      const pkg = await prisma.contentPackage.create({
        data: {
          modelId: profile.id,
          title: `${t.title} - ${m.stageName}`,
          description:
            t.price === 0
              ? 'Contenido gratuito para conocer mi estilo.'
              : 'Contenido exclusivo solo para quien lo desbloquea. Sin reventa.',
          type: t.type,
          priceTokens: t.price,
          isPublic: t.price === 0,
          isPublished: true,
          previewUrl: photo(`${m.stageName}-${idx}`),
          assetCount,
          purchaseCount: t.price === 0 ? 0 : randInt(3, 220),
          tokensEarned: t.price === 0 ? 0 : t.price * randInt(3, 220),
        },
      });

      for (let a = 0; a < assetCount; a++) {
        await prisma.contentAsset.create({
          data: {
            packageId: pkg.id,
            storageKey: photo(`${m.stageName}-${idx}-${a}`),
            mimeType: t.type === ContentType.VIDEO ? 'video/mp4' : 'image/jpeg',
            sizeBytes: randInt(200_000, 8_000_000),
            width: 800,
            height: 1000,
            durationSec: t.type === ContentType.VIDEO ? randInt(60, 600) : null,
            isPreview: a === 0,
            sortOrder: a,
          },
        });
      }
    }

    // --- KYC ---
    if (m.kyc !== KycStatus.NOT_SUBMITTED) {
      await prisma.kycVerification.create({
        data: {
          modelId: profile.id,
          status: m.kyc,
          fullLegalName: m.name,
          birthDate: birthDateForAge(m.age),
          country: m.country,
          documentType: pick([
            DocumentType.PASSPORT,
            DocumentType.NATIONAL_ID,
            DocumentType.DRIVERS_LICENSE,
          ]),
          documentNumber: `DOC-${randInt(100000, 999999)}`,
          documentFrontKey: `kyc/${profile.id}/front.jpg`,
          documentBackKey: `kyc/${profile.id}/back.jpg`,
          selfieKey: `kyc/${profile.id}/selfie.jpg`,
          handwrittenNoteKey: `kyc/${profile.id}/note.jpg`,
          submittedAt: daysAgo(randInt(2, 60)),
          reviewedAt: m.kyc === KycStatus.PENDING ? null : daysAgo(randInt(1, 30)),
          reviewerId: m.kyc === KycStatus.PENDING ? null : admin.id,
          rejectionReason:
            m.kyc === KycStatus.REJECTED
              ? 'La foto del documento esta borrosa y no coincide con el selfie.'
              : null,
          reviewNotes:
            m.kyc === KycStatus.APPROVED ? 'Documentacion correcta. 2257 archivado.' : null,
        },
      });
    }

    // --- Payouts ---
    if (m.kyc === KycStatus.APPROVED) {
      const payoutTokens = randInt(600, 6000);
      await prisma.payoutRequest.create({
        data: {
          modelId: profile.id,
          status: pick([
            PayoutStatus.REQUESTED,
            PayoutStatus.APPROVED,
            PayoutStatus.PAID,
            PayoutStatus.PROCESSING,
          ]),
          tokens: payoutTokens,
          amountCents: payoutTokens * 5,
          currency: 'USD',
          method: pick([
            PayoutMethod.BANK_TRANSFER,
            PayoutMethod.PAYPAL,
            PayoutMethod.CRYPTO,
            PayoutMethod.PAXUM,
          ]),
          destination: `****${randInt(1000, 9999)}`,
          requestedAt: daysAgo(randInt(1, 25)),
        },
      });
    }

    // --- Resenas ---
    for (const reviewer of pickMany(users, randInt(2, 5))) {
      await prisma.review.create({
        data: {
          modelId: profile.id,
          userId: reviewer.id,
          rating: randInt(4, 5),
          comment: pick([
            'Muy atenta y natural, repetire.',
            'Buena conexion y sin prisas.',
            'La mejor experiencia que he tenido aqui.',
            'Puntual y muy profesional.',
            'Conversacion excelente antes del show.',
          ]),
          createdAt: daysAgo(randInt(1, 60)),
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 6. Desbloqueos de contenido
  // -------------------------------------------------------------------------
  console.log('[seed] Desbloqueos de contenido...');
  const paidPackages = await prisma.contentPackage.findMany({
    where: { priceTokens: { gt: 0 } },
    include: { model: { select: { userId: true, stageName: true } } },
  });

  for (const user of users.slice(0, 5)) {
    for (const pkg of pickMany(paidPackages, randInt(1, 4))) {
      const exists = await prisma.contentUnlock.findUnique({
        where: { userId_packageId: { userId: user.id, packageId: pkg.id } },
      });
      if (exists) continue;

      const fee = Math.round((pkg.priceTokens * COMMISSION) / 100);
      const createdAt = daysAgo(randInt(1, 45));

      await prisma.contentUnlock.create({
        data: {
          userId: user.id,
          packageId: pkg.id,
          tokensSpent: pkg.priceTokens,
          createdAt,
        },
      });

      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.CONTENT_UNLOCK,
          tokens: -pkg.priceTokens,
          description: `Desbloqueo: ${pkg.title}`,
          contentPackageId: pkg.id,
          platformFeeTokens: fee,
          createdAt,
        },
      });

      await prisma.transaction.create({
        data: {
          userId: pkg.model.userId,
          type: TransactionType.CONTENT_EARNING,
          tokens: pkg.priceTokens - fee,
          description: `Venta: ${pkg.title}`,
          contentPackageId: pkg.id,
          createdAt,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 7. Historial de llamadas
  // -------------------------------------------------------------------------
  console.log('[seed] Historial de llamadas...');
  const vipModels = models.filter((m) => m.profile.isVipEnabled);

  for (let i = 0; i < 45; i++) {
    const user = pick(users);
    const isRandom = Math.random() < 0.4;
    const target = pick(isRandom ? models : vipModels);
    const type = isRandom
      ? CallType.RANDOM
      : Math.random() < 0.6
        ? CallType.VIP_RANDOM
        : CallType.PRIVATE;

    const rate =
      type === CallType.RANDOM
        ? 0
        : type === CallType.VIP_RANDOM
          ? target.profile.vipRatePerMinute
          : target.profile.privateRatePerMinute;

    const seconds = randInt(45, 2400);
    const tokensSpent = Math.ceil((rate * seconds) / 60);
    const fee = Math.round((tokensSpent * COMMISSION) / 100);
    const startedAt = daysAgo(Math.random() * 45);
    const endedAt = new Date(startedAt.getTime() + seconds * 1000);

    const session = await prisma.callSession.create({
      data: {
        type,
        status: CallStatus.ENDED,
        callerId: user.id,
        calleeId: target.user.id,
        roomName: `seed_${type.toLowerCase()}_${i}_${Date.now().toString(36)}`,
        ratePerMinute: rate,
        startedAt,
        endedAt,
        lastBilledAt: endedAt,
        billedSeconds: seconds,
        tokensSpent,
        tokensEarned: tokensSpent - fee,
        platformFeeTokens: fee,
        endReason: pick([
          CallEndReason.USER_HANGUP,
          CallEndReason.PARTNER_HANGUP,
          CallEndReason.NEXT_SKIP,
          CallEndReason.INSUFFICIENT_TOKENS,
        ]),
        createdAt: startedAt,
      },
    });

    if (tokensSpent > 0) {
      await prisma.transaction.createMany({
        data: [
          {
            userId: user.id,
            type: TransactionType.CALL_CHARGE,
            tokens: -tokensSpent,
            description: `Llamada ${type} con ${target.profile.stageName}`,
            callSessionId: session.id,
            platformFeeTokens: fee,
            createdAt: endedAt,
          },
          {
            userId: target.user.id,
            type: TransactionType.CALL_EARNING,
            tokens: tokensSpent - fee,
            description: `Ganancia llamada ${type}`,
            callSessionId: session.id,
            createdAt: endedAt,
          },
        ],
      });

      // Ticks de facturacion de auditoria
      let remaining = seconds;
      while (remaining > 0) {
        const chunk = Math.min(15, remaining);
        const chunkTokens = Math.ceil((rate * chunk) / 60);
        await prisma.callBillingTick.create({
          data: {
            sessionId: session.id,
            seconds: chunk,
            tokensCharged: chunkTokens,
            tokensCredited: chunkTokens - Math.round((chunkTokens * COMMISSION) / 100),
            feeTokens: Math.round((chunkTokens * COMMISSION) / 100),
            createdAt: new Date(startedAt.getTime() + (seconds - remaining) * 1000),
          },
        });
        remaining -= chunk;
        if (seconds > 600 && remaining > 60) remaining -= 60; // acelera el seed
      }
    }

    // Propinas ocasionales
    if (Math.random() < 0.35 && rate > 0) {
      const tipTokens = pick([5, 15, 50, 100]);
      const tipFee = Math.round((tipTokens * COMMISSION) / 100);
      const gift = await prisma.gift.create({
        data: {
          sessionId: session.id,
          senderId: user.id,
          receiverId: target.user.id,
          tokens: tipTokens,
          emoji: pick(['🌹', '🍸', '🔥', '💎', '👑']),
          message: pick(['Gracias!', 'Increible show', 'Para ti', '']),
          createdAt: endedAt,
        },
      });

      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.TIP,
          tokens: -tipTokens,
          description: `Propina a ${target.profile.stageName}`,
          callSessionId: session.id,
          giftId: gift.id,
          platformFeeTokens: tipFee,
          createdAt: endedAt,
        },
      });
      await prisma.transaction.create({
        data: {
          userId: target.user.id,
          type: TransactionType.TIP_EARNING,
          tokens: tipTokens - tipFee,
          description: `Propina recibida`,
          callSessionId: session.id,
          createdAt: endedAt,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 8. Reservas (pasadas, activas y futuras)
  // -------------------------------------------------------------------------
  console.log('[seed] Reservas...');
  const bookableModels = models.filter((m) => m.profile.acceptsBookings);

  const bookingPlans: Array<{ status: BookingStatus; hoursOffset: number }> = [
    { status: BookingStatus.CONFIRMED, hoursOffset: 6 },
    { status: BookingStatus.CONFIRMED, hoursOffset: 30 },
    { status: BookingStatus.PENDING_CONFIRMATION, hoursOffset: 52 },
    { status: BookingStatus.PENDING_CONFIRMATION, hoursOffset: 74 },
    { status: BookingStatus.COMPLETED, hoursOffset: -48 },
    { status: BookingStatus.COMPLETED, hoursOffset: -120 },
    { status: BookingStatus.CANCELLED_BY_USER, hoursOffset: -18 },
    { status: BookingStatus.CANCELLED_BY_MODEL, hoursOffset: -60 },
    { status: BookingStatus.NO_SHOW, hoursOffset: -200 },
    { status: BookingStatus.CONFIRMED, hoursOffset: 96 },
  ];

  for (const plan of bookingPlans) {
    const user = pick(users);
    const target = pick(bookableModels);
    const duration = pick([15, 20, 30, 45, 60]);
    const rate = target.profile.privateRatePerMinute;
    const total = rate * duration;

    const booking = await prisma.booking.create({
      data: {
        userId: user.id,
        modelId: target.profile.id,
        status: plan.status,
        startsAt: hoursFromNow(plan.hoursOffset),
        durationMinutes: duration,
        ratePerMinute: rate,
        totalTokens: total,
        userNote: pick([
          'Quiero una sesion tranquila, primera vez.',
          'Cumpleanos, algo especial por favor.',
          'Podemos hablar en ingles?',
          '',
        ]),
        confirmedAt:
          plan.status === BookingStatus.CONFIRMED ||
          plan.status === BookingStatus.COMPLETED
            ? daysAgo(randInt(1, 5))
            : null,
        completedAt:
          plan.status === BookingStatus.COMPLETED ? hoursFromNow(plan.hoursOffset + 1) : null,
        cancelledAt:
          plan.status === BookingStatus.CANCELLED_BY_USER ||
          plan.status === BookingStatus.CANCELLED_BY_MODEL
            ? daysAgo(randInt(1, 3))
            : null,
        refundedTokens:
          plan.status === BookingStatus.CANCELLED_BY_MODEL ? total : 0,
        createdAt: daysAgo(randInt(1, 10)),
      },
    });

    if (plan.status !== BookingStatus.CANCELLED_BY_USER) {
      await prisma.transaction.create({
        data: {
          userId: user.id,
          type: TransactionType.BOOKING_HOLD,
          tokens: -total,
          description: `Reserva con ${target.profile.stageName} (${duration} min)`,
          bookingId: booking.id,
          createdAt: booking.createdAt,
        },
      });
    }
  }

  // -------------------------------------------------------------------------
  // 9. Reportes / disputas
  // -------------------------------------------------------------------------
  console.log('[seed] Reportes y disputas...');
  const endedSessions = await prisma.callSession.findMany({
    take: 8,
    orderBy: { createdAt: 'desc' },
  });

  const reportPlans = [
    { reason: ReportReason.HARASSMENT, status: ReportStatus.OPEN },
    { reason: ReportReason.SPAM, status: ReportStatus.UNDER_REVIEW },
    { reason: ReportReason.PAYMENT_DISPUTE, status: ReportStatus.OPEN },
    { reason: ReportReason.TECHNICAL_ISSUE, status: ReportStatus.RESOLVED },
    { reason: ReportReason.IMPERSONATION, status: ReportStatus.ESCALATED },
    { reason: ReportReason.OTHER, status: ReportStatus.DISMISSED },
  ];

  for (const [i, plan] of reportPlans.entries()) {
    const session = endedSessions[i % endedSessions.length];
    if (!session) break;
    await prisma.report.create({
      data: {
        reporterId: session.callerId,
        reportedId: session.calleeId ?? banned.id,
        sessionId: session.id,
        reason: plan.reason,
        status: plan.status,
        details: pick([
          'La otra persona se comporto de forma agresiva en la llamada.',
          'Me cobraron tokens y el video nunca conecto.',
          'Perfil claramente falso, no coincide con las fotos.',
          'Corte constante de video durante toda la sesion.',
        ]),
        reviewerId:
          plan.status === ReportStatus.OPEN ? null : admin.id,
        reviewedAt: plan.status === ReportStatus.OPEN ? null : daysAgo(randInt(1, 6)),
        resolution:
          plan.status === ReportStatus.RESOLVED
            ? 'Se reembolsaron los tokens al usuario.'
            : plan.status === ReportStatus.DISMISSED
              ? 'Sin evidencia suficiente.'
              : null,
        createdAt: daysAgo(randInt(1, 12)),
      },
    });
  }

  // -------------------------------------------------------------------------
  // 10. Registro de auditoria
  // -------------------------------------------------------------------------
  await prisma.auditLog.createMany({
    data: [
      { actorId: admin.id, action: 'KYC_APPROVED', entityType: 'KycVerification', metadata: { note: 'Lote inicial' } },
      { actorId: admin.id, action: 'USER_SUSPENDED', entityType: 'User', entityId: suspended.id, metadata: { hours: 72 } },
      { actorId: admin.id, action: 'USER_BANNED', entityType: 'User', entityId: banned.id, metadata: { reason: 'Fraude' } },
      { actorId: admin.id, action: 'SEED_EXECUTED', entityType: 'System', metadata: { at: new Date().toISOString() } },
    ],
  });

  // -------------------------------------------------------------------------
  // Resumen
  // -------------------------------------------------------------------------
  const counts = {
    usuarios: await prisma.user.count(),
    modelos: await prisma.modelProfile.count(),
    paquetesTokens: await prisma.tokenPackage.count(),
    paquetesContenido: await prisma.contentPackage.count(),
    llamadas: await prisma.callSession.count(),
    transacciones: await prisma.transaction.count(),
    reservas: await prisma.booking.count(),
    kyc: await prisma.kycVerification.count(),
    payouts: await prisma.payoutRequest.count(),
    reportes: await prisma.report.count(),
  };

  console.log('\n===========================================');
  console.log('  SEED COMPLETADO');
  console.log('===========================================');
  console.table(counts);
  console.log('\n  CREDENCIALES DE PRUEBA');
  console.log('  -----------------------------------------');
  console.log(`  Contrasena para TODAS las cuentas: ${SEED_PASSWORD}\n`);
  console.log('  ADMIN   admin@fantasylive.test');
  console.log('  USUARIO usuario@fantasylive.test   (1250 tokens, VIP)');
  console.log('  USUARIO laura@fantasylive.test     (90 tokens)');
  console.log('  USUARIO tom@fantasylive.test       (0 tokens, para probar el paywall)');
  console.log('  MODELO  valentina@fantasylive.test (Elite, online, KYC OK)');
  console.log('  MODELO  mateo@fantasylive.test     (Gay, VIP, online)');
  console.log('  MODELO  nina@fantasylive.test      (Trans femenina, VIP)');
  console.log('  MODELO  kai@fantasylive.test       (No binario, online)');
  console.log('  MODELO  adrian@fantasylive.test    (KYC pendiente de revision)');
  console.log('  MODELO  thiago@fantasylive.test    (KYC rechazado)');
  console.log('  MODELO  erik@fantasylive.test      (KYC sin enviar)');
  console.log('===========================================\n');
}

main()
  .catch((e) => {
    console.error('[seed] ERROR:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
