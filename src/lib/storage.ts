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
  });
  return client;
}

export function isStorageConfigured(): boolean {
  return config.storage.configured;
}

/**
 * Construye una clave privada y predecible para el contenido de una modelo.
 * Ej: models/<modelId>/packages/<packageId>/<uuid>.jpg
 */
export function buildContentKey(params: {
  modelId: string;
  packageId: string;
  filename: string;
}): string {
  const ext = params.filename.split('.').pop()?.toLowerCase() || 'bin';
  const id = crypto.randomUUID();
  return `models/${params.modelId}/packages/${params.packageId}/${id}.${ext}`;
}

/** Ej: messages/<conversationId>/<uuid>.jpg */
export function buildMessageAttachmentKey(params: {
  conversationId: string;
  filename: string;
}): string {
  const ext = params.filename.split('.').pop()?.toLowerCase() || 'bin';
  const id = crypto.randomUUID();
  return `messages/${params.conversationId}/${id}.${ext}`;
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

/** URL firmada para SUBIR un objeto directamente desde el navegador. */
export async function createUploadUrl(params: {
  key: string;
  contentType: string;
  maxSizeBytes?: number;
}): Promise<string | null> {
  const s3 = getClient();
  if (!s3) return null;

  const command = new PutObjectCommand({
    Bucket: config.storage.bucket,
    Key: params.key,
    ContentType: params.contentType,
  });

  return getSignedUrl(s3, command, { expiresIn: 60 * 10 });
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
