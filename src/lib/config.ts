/**
 * Configuracion central leida de variables de entorno.
 * Todo valor tiene fallback seguro para que el proyecto arranque en local
 * sin configurar nada mas que DATABASE_URL.
 */

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function bool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === '') return fallback;
  return value === 'true' || value === '1';
}

function clampPercent(value: number): number {
  return Math.min(100, Math.max(0, Math.round(value)));
}

/**
 * REPARTO DE INGRESOS - punto unico de verdad.
 *
 * La comision se aplica UNA SOLA VEZ, en el momento en que el usuario gasta
 * tokens (ver splitEarnings en src/lib/tokens.ts): la plataforma retiene
 * `platformCommissionPercent` y el resto se acredita a la modelo.
 *
 * Por eso el retiro paga el token a su valor integro (tokenValueCents): si
 * ademas se recortara aqui, la comision se cobraria dos veces. Mantener
 * MODEL_PAYOUT_CENTS_PER_TOKEN == TOKEN_VALUE_CENTS salvo que se quiera
 * justamente eso.
 *
 * Con los valores por defecto (comision 50%, token a $0.10):
 *   usuario paga $10 -> 100 tokens -> modelo recibe 50 tokens -> retira $5.00
 */
const tokenValueCents = num(process.env.TOKEN_VALUE_CENTS, 10);
const platformCommissionPercent = clampPercent(
  num(process.env.PLATFORM_COMMISSION_PERCENT, 50),
);

export const config = {
  app: {
    name: process.env.NEXT_PUBLIC_APP_NAME || 'FantasyLive',
    url: process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000',
    minAge: num(process.env.NEXT_PUBLIC_MIN_AGE, 18),
  },
  economy: {
    /** Precio de venta de 1 token al usuario (centavos) */
    tokenValueCents,
    /** Lo que cobra la modelo por token ganado (centavos) */
    modelPayoutCentsPerToken: num(
      process.env.MODEL_PAYOUT_CENTS_PER_TOKEN,
      tokenValueCents,
    ),
    /** Comision de la plataforma sobre tokens gastados (%) */
    platformCommissionPercent,
    /** Porcentaje que se lleva la modelo. Derivado, nunca se configura aparte. */
    modelRevenueSharePercent: 100 - platformCommissionPercent,
    signupBonusTokens: num(process.env.SIGNUP_BONUS_TOKENS, 25),
    minPayoutTokens: num(process.env.MIN_PAYOUT_TOKENS, 500),
    /** Cada cuantos segundos el cliente envia un tick de cobro */
    callBillingIntervalSeconds: num(process.env.CALL_BILLING_INTERVAL_SECONDS, 15),
  },
  geo: {
    /**
     * Leer el pais de las cabeceras del proxy (cf-ipcountry, x-real-ip...).
     * Solo debe estar activo si hay un proxy delante que las sobrescribe.
     * El nginx de deploy/nginx.conf lo hace; activarlo sin proxy permitiria a
     * cualquiera saltarse el bloqueo geografico mandando la cabecera a mano.
     */
    trustProxyHeaders: bool(process.env.GEO_TRUST_PROXY_HEADERS, true),
    /** Proxies de confianza delante de la app (para leer X-Forwarded-For). */
    trustedProxyHops: Math.max(1, num(process.env.GEO_TRUSTED_PROXY_HOPS, 1)),
    /** Fuerza un pais concreto. Solo para desarrollo y pruebas de QA. */
    overrideCountry: (process.env.GEO_OVERRIDE_COUNTRY || '')
      .trim()
      .toUpperCase() || null,
  },
  media: {
    provider: (process.env.NEXT_PUBLIC_MEDIA_PROVIDER || 'livekit') as
      | 'livekit'
      | 'p2p',
    livekit: {
      apiKey: process.env.LIVEKIT_API_KEY || '',
      apiSecret: process.env.LIVEKIT_API_SECRET || '',
      url: process.env.LIVEKIT_URL || process.env.NEXT_PUBLIC_LIVEKIT_URL || '',
      configured: Boolean(
        process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET,
      ),
    },
    signalingUrl: process.env.NEXT_PUBLIC_SIGNALING_URL || '',
    stunUrls: (
      process.env.NEXT_PUBLIC_STUN_URLS || 'stun:stun.l.google.com:19302'
    ).split(','),
    turn: {
      url: process.env.TURN_URL || '',
      username: process.env.TURN_USERNAME || '',
      credential: process.env.TURN_CREDENTIAL || '',
    },
  },
  storage: {
    endpoint: process.env.S3_ENDPOINT || '',
    region: process.env.S3_REGION || 'auto',
    bucket: process.env.S3_BUCKET || 'fantasylive-content',
    accessKeyId: process.env.S3_ACCESS_KEY_ID || '',
    secretAccessKey: process.env.S3_SECRET_ACCESS_KEY || '',
    forcePathStyle: bool(process.env.S3_FORCE_PATH_STYLE, true),
    publicBaseUrl: process.env.S3_PUBLIC_BASE_URL || '',
    signedUrlTtlMinutes: num(process.env.SIGNED_URL_TTL_MINUTES, 15),
    get configured() {
      return Boolean(
        process.env.S3_ACCESS_KEY_ID && process.env.S3_SECRET_ACCESS_KEY,
      );
    },
  },
  payments: {
    provider: (process.env.PAYMENT_PROVIDER || 'mock') as
      | 'stripe'
      | 'ccbill'
      | 'crypto'
      | 'mock',
    stripe: {
      secretKey: process.env.STRIPE_SECRET_KEY || '',
      webhookSecret: process.env.STRIPE_WEBHOOK_SECRET || '',
      publishableKey: process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY || '',
    },
    ccbill: {
      accnum: process.env.CCBILL_CLIENT_ACCNUM || '',
      subacc: process.env.CCBILL_CLIENT_SUBACC || '',
      flexFormId: process.env.CCBILL_FLEXFORM_ID || '',
      salt: process.env.CCBILL_SALT || '',
    },
    paypal: {
      clientId: process.env.PAYPAL_CLIENT_ID || '',
      clientSecret: process.env.PAYPAL_CLIENT_SECRET || '',
      webhookId: process.env.PAYPAL_WEBHOOK_ID || '',
      /** "live" en produccion, "sandbox" para pruebas */
      mode: (process.env.PAYPAL_MODE || 'sandbox') as 'sandbox' | 'live',
      get configured() {
        return Boolean(
          process.env.PAYPAL_CLIENT_ID && process.env.PAYPAL_CLIENT_SECRET,
        );
      },
    },
  },
  moderation: {
    adminAlertEmail: process.env.ADMIN_ALERT_EMAIL || 'admin@fantasylive.test',
    requireKycToStream: bool(process.env.REQUIRE_KYC_TO_STREAM, true),
  },
  matchmaking: {
    /** Segundos sin heartbeat tras los que una entrada de cola se descarta */
    queueTtlSeconds: 30,
    /** Minutos que dura un skip antes de poder reemparejar con la misma persona */
    skipCooldownMinutes: 60,
  },
} as const;

export type AppConfig = typeof config;
