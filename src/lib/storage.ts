import 'server-only';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { config } from '@/lib/config';

let client: S3Client | null = null;

function getClient(): S3Client | null {
  if (!config.storage.configured) return null;
  if (client) return client;

  client = new S3Client({
    region: config.storage.region,
    endpoint: config.storage.endpoint || undefined,
    forcePathStyle: config.storage.forcePathStyle,
    credentials: {
      accessKeyId: config.storage.accessKeyId,
      secretAccessKey: config.storage.secretAccessKey,
    },
    // Por defecto el SDK mete en cada URL firmada un checksum (CRC32) del
    // cuerpo... que al firmar aun no existe, asi que es el de un cuerpo
    // vacio. Los servidores S3 que lo comprueban (SeaweedFS, R2...) rechazan
    // entonces toda subida real con BadDigest. Solo cuando la operacion lo
    // exige.
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  return client;
}

export function isStorageConfigured(): boolean {
  return config.storage.configured;
}

export function buildMessageAttachmentKey(params: {
  conversationId: string;
  filename: string;
}): string {
  const ext = params.filename.split('.').pop()?.toLowerCase() || 'bin';
  const id = crypto.randomUUID();
  return `messages/${params.conversationId}/${id}.${ext}`;
}

/**
 * Claves de una publicacion del feed.
 *
 * El original y su miniatura difuminada van a claves distintas porque tienen
 * permisos distintos: la miniatura se sirve a cualquiera (es lo que se ve
 * borroso sin pagar) y el original solo a quien haya desbloqueado.
 * Ej: models/<modelId>/posts/<postId>/<uuid>.jpg
 *     models/<modelId>/posts/<postId>/<uuid>-preview.jpg
 */
export function buildPostKey(params: {
  modelId: string;
  postId: string;
  filename: string;
  isPreview?: boolean;
}): string {
  const ext = params.filename.split('.').pop()?.toLowerCase() || 'bin';
  const id = crypto.randomUUID();
  const suffix = params.isPreview ? '-preview' : '';
  return `models/${params.modelId}/posts/${params.postId}/${id}${suffix}.${ext}`;
}

/** Boveda de la creadora (privada). Ej: models/<modelId>/vault/<uuid>.jpg */
export function buildVaultKey(params: { modelId: string; filename: string }): string {
  const ext = params.filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
  return `models/${params.modelId}/vault/${crypto.randomUUID()}.${ext}`;
}

/** La clave es de la Boveda de ESTA creadora (y no una ruta inventada). */
export function isVaultKeyOf(modelId: string, key: string): boolean {
  return new RegExp(`^models/${modelId}/vault/[0-9a-f-]{36}\\.[a-z0-9]+$`).test(key);
}

/** Ej: models/<modelId>/greeting/<uuid>.jpg */
export function buildGreetingKey(params: {
  modelId: string;
  filename: string;
  isPreview?: boolean;
}): string {
  const ext = params.filename.split('.').pop()?.toLowerCase() || 'bin';
  const id = crypto.randomUUID();
  const suffix = params.isPreview ? '-preview' : '';
  return `models/${params.modelId}/greeting/${id}${suffix}.${ext}`;
}

/**
 * Foto de perfil o portada de una modelo.
 *
 * Son las unicas imagenes del bucket que se sirven sin firma a cualquiera
 * (ver `/api/public-media`), asi que viven bajo un prefijo propio que la ruta
 * publica comprueba antes de servir nada.
 * Ej: models/<modelId>/profile/avatar-<uuid>.jpg
 */
export function buildProfileImageKey(params: {
  modelId: string;
  kind: 'avatar' | 'cover';
}): string {
  return `models/${params.modelId}/profile/${params.kind}-${crypto.randomUUID()}.jpg`;
}

const PROFILE_IMAGE_KEY = /^models\/[\w-]+\/profile\/(avatar|cover)-[\w-]+\.jpg$/;
const USER_AVATAR_KEY = /^users\/[\w-]+\/avatar-[\w-]+\.jpg$/;

/** La clave es una foto de perfil/portada (y por tanto publica). */
export function isProfileImageKey(key: string): boolean {
  return PROFILE_IMAGE_KEY.test(key) || USER_AVATAR_KEY.test(key);
}

/** Foto de perfil de una cuenta (fan). Ej: users/<userId>/avatar-<uuid>.jpg */
export function buildUserAvatarKey(userId: string): string {
  return `users/${userId}/avatar-${crypto.randomUUID()}.jpg`;
}

/**
 * URL estable para guardar en `avatarUrl`/`coverUrl`. Con CDN apunta a ella;
 * sin CDN, a la ruta propia que redirige a una URL firmada.
 */
export function profileImageUrl(key: string): string {
  if (config.storage.publicBaseUrl) {
    return `${config.storage.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  return `/api/public-media/${key}`;
}

export function buildKycKey(params: {
  modelId: string;
  kind: 'front' | 'back' | 'selfie' | 'note';
  filename: string;
}): string {
  const ext = params.filename.split('.').pop()?.toLowerCase() || 'bin';
  const id = crypto.randomUUID();
  return `kyc/${params.modelId}/${params.kind}-${id}.${ext}`;
}

/** Comprobante de pago de una compra a un distribuidor (privado). */
export function buildDistributorProofKey(params: { saleId: string; filename: string }): string {
  const ext = params.filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `distributor-proofs/${params.saleId}/${crypto.randomUUID()}.${ext}`;
}

export function isDistributorProofKeyOf(saleId: string, key: string): boolean {
  return key.startsWith(`distributor-proofs/${saleId}/`) && !key.includes('..');
}

/** Recibo del pago de un lote que envia el distribuidor (privado). */
export function buildDistributorLotProofKey(params: { orderId: string; filename: string }): string {
  const ext = params.filename.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
  return `distributor-lots/${params.orderId}/${crypto.randomUUID()}.${ext}`;
}

export function isDistributorLotProofKeyOf(orderId: string, key: string): boolean {
  return key.startsWith(`distributor-lots/${orderId}/`) && !key.includes('..');
}

// ---------------------------------------------------------------------------
// Que se puede subir
// ---------------------------------------------------------------------------

/**
 * Tipos admitidos y tamaño maximo de cada uno. El almacenamiento se sirve
 * desde el mismo dominio que la web: un archivo HTML o SVG subido ahi podria
 * ejecutar codigo como si fuera la propia web, por eso solo pasan estos.
 */
const UPLOAD_KINDS = {
  image: { re: /^image\/(jpeg|png|webp|gif|heic|heif)$/, maxBytes: 30 * 1024 * 1024, label: 'imágenes de 30 MB' },
  video: { re: /^video\/(mp4|quicktime|webm|x-m4v)$/, maxBytes: 2 * 1024 * 1024 * 1024, label: 'videos de 2 GB' },
  pdf: { re: /^application\/pdf$/, maxBytes: 15 * 1024 * 1024, label: 'PDF de 15 MB' },
} as const;

export type UploadKind = keyof typeof UPLOAD_KINDS;

/** null si el archivo vale; si no, el motivo para enseñarlo. */
export function checkUpload(contentType: string, sizeBytes: unknown, allowed: UploadKind[]): string | null {
  const kind = allowed.find((k) => UPLOAD_KINDS[k].re.test(contentType));
  if (!kind) return 'Ese tipo de archivo no se admite aquí.';
  if (typeof sizeBytes !== 'number' || !Number.isInteger(sizeBytes) || sizeBytes <= 0) {
    return 'No se pudo leer el tamaño del archivo.';
  }
  if (sizeBytes > UPLOAD_KINDS[kind].maxBytes) {
    return `El archivo es demasiado grande (máximo: ${UPLOAD_KINDS[kind].label}).`;
  }
  return null;
}

/**
 * URL firmada para SUBIR un objeto directamente desde el navegador.
 *
 * Tipo y tamaño van dentro de la firma: el almacenamiento rechaza (403) una
 * subida con otro Content-Type u otro tamaño. Sin esto, una URL pedida para
 * una foto servia para subir una pagina web, o un archivo de cualquier tamaño.
 * Llamar antes a checkUpload().
 */
export async function createUploadUrl(params: {
  key: string;
  contentType: string;
  sizeBytes: number;
}): Promise<string | null> {
  const s3 = getClient();
  if (!s3) return null;

  const command = new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: params.key,
    ContentType: params.contentType,
    ContentLength: params.sizeBytes,
  });

  return getSignedUrl(s3, command, {
    expiresIn: 60 * 10,
    signableHeaders: new Set(['content-type']),
  });
}

/** URL firmada para LEER contenido privado ya desbloqueado. */
export async function createDownloadUrl(key: string): Promise<string | null> {
  const s3 = getClient();
  if (!s3) return null;

  const command = new GetObjectCommand({
    Bucket: config.storage.bucket,
    Key: key,
  });

  return getSignedUrl(s3, command, {
    expiresIn: config.storage.signedUrlTtlMinutes * 60,
  });
}

/**
 * Descarga un objeto privado al servidor (para procesarlo antes de servirlo,
 * p. ej. la marca de agua del contenido de pago). null si no existe.
 */
export async function getObjectBuffer(key: string): Promise<Buffer | null> {
  if (/^https?:\/\//i.test(key)) {
    const res = await fetch(key, { signal: AbortSignal.timeout(15_000) });
    return res.ok ? Buffer.from(await res.arrayBuffer()) : null;
  }
  const s3 = getClient();
  if (!s3) return null;
  try {
    const result = await s3.send(
      new GetObjectCommand({ Bucket: config.storage.bucket, Key: key }),
    );
    if (!result.Body) return null;
    return Buffer.from(await result.Body.transformToByteArray());
  } catch {
    return null;
  }
}

/** Sube desde el servidor un archivo pequeno (p. ej. una miniatura). */
export async function putObject(key: string, body: Buffer, contentType: string): Promise<boolean> {
  const s3 = getClient();
  if (!s3) return false;
  await s3.send(
    new PutObjectCommand({ Bucket: config.storage.bucket, Key: key, Body: body, ContentType: contentType }),
  );
  return true;
}

export async function deleteObject(key: string): Promise<void> {
  const s3 = getClient();
  if (!s3) return;
  await s3.send(
    new DeleteObjectCommand({ Bucket: config.storage.bucket, Key: key }),
  );
}

/**
 * Resuelve la URL visible de un asset.
 * - Si la clave ya es una URL absoluta (datos de seed), se devuelve tal cual.
 * - Si es preview publico y hay CDN, se sirve por CDN.
 * - En cualquier otro caso se firma.
 */
export async function resolveAssetUrl(
  key: string,
  opts: { isPublic?: boolean } = {},
): Promise<string | null> {
  if (/^https?:\/\//i.test(key)) return key;
  if (opts.isPublic && config.storage.publicBaseUrl) {
    return `${config.storage.publicBaseUrl.replace(/\/$/, '')}/${key}`;
  }
  return createDownloadUrl(key);
}
