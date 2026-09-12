'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, ImagePlus, Loader2, Lock, Send, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/components/providers/i18n-provider';
import {
  attachPostAssetAction,
  createPostAction,
  publishPostAction,
  requestPostUploadUrlAction,
} from '@/server/actions/posts';
import {
  createBlurredPreview,
  putToSignedUrl,
  readImageSize,
} from '@/lib/blur-preview';

type Visibility = 'PUBLIC' | 'LOCKED' | 'SUBSCRIBERS';

const MAX_FILES = 6;
const MAX_FILE_BYTES = 50 * 1024 * 1024;

export function PostComposer({
  subscriptionEnabled,
}: {
  subscriptionEnabled: boolean;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<Visibility>('PUBLIC');
  const [priceTokens, setPriceTokens] = useState(50);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function pickFiles(selected: FileList | null) {
    if (!selected) return;
    const next: File[] = [];
    for (const file of Array.from(selected)) {
      if (file.size > MAX_FILE_BYTES) {
        toast.error(`${file.name} pesa mas de 50 MB.`);
        continue;
      }
      next.push(file);
    }
    setFiles((prev) => [...prev, ...next].slice(0, MAX_FILES));
  }

  /**
   * Publica en tres pasos: crear borrador, subir cada archivo (con su
   * miniatura difuminada si la publicacion es de pago) y publicar.
   *
   * Se hace asi porque la clave de S3 necesita el id del post, y porque una
   * subida a medias no debe aparecer en el feed de nadie.
   */
  function publish() {
    if (!body.trim() && files.length === 0) {
      toast.error('Escribe algo o anade una foto.');
      return;
    }
    if (visibility === 'LOCKED' && priceTokens <= 0) {
      toast.error('Pon un precio mayor que 0 para una publicacion de pago.');
      return;
    }
    if (visibility !== 'PUBLIC' && files.length === 0) {
      toast.error('Una publicacion de pago necesita al menos una foto o video.');
      return;
    }

    startTransition(async () => {
      setProgress('Creando publicacion...');
      const created = await createPostAction({
        body: body.trim() || undefined,
        visibility,
        priceTokens: visibility === 'LOCKED' ? priceTokens : 0,
      });

      if (!created.ok || !created.data) {
        setProgress(null);
        toast.error(created.error ?? t('common.somethingWentWrong'));
        return;
      }

      const postId = created.data.postId;
      const needsPreview = visibility !== 'PUBLIC';

      for (let i = 0; i < files.length; i++) {
        const file = files[i]!;
        setProgress(`Subiendo ${i + 1} de ${files.length}...`);

        const signed = await requestPostUploadUrlAction({
          postId,
          filename: file.name,
          contentType: file.type || 'application/octet-stream',
        });
        if (!signed.ok || !signed.data) {
          setProgress(null);
          toast.error(signed.error ?? 'No se pudo subir el archivo.');
          return;
        }

        const uploaded = await putToSignedUrl(
          signed.data.uploadUrl,
          file,
          file.type || 'application/octet-stream',
        );
        if (!uploaded) {
          setProgress(null);
          toast.error(`No se pudo subir ${file.name}.`);
          return;
        }

        // Miniatura difuminada: se genera aqui, en el navegador, y se sube a
        // una clave distinta. Es lo unico que se sirve sin pagar.
        let previewKey: string | undefined;
        if (needsPreview) {
          const preview = await createBlurredPreview(file);
          if (preview) {
            const signedPreview = await requestPostUploadUrlAction({
              postId,
              filename: `${file.name}.jpg`,
              contentType: 'image/jpeg',
              isPreview: true,
            });
            if (signedPreview.ok && signedPreview.data) {
              const okPreview = await putToSignedUrl(
                signedPreview.data.uploadUrl,
                preview.blob,
                'image/jpeg',
              );
              if (okPreview) previewKey = signedPreview.data.key;
            }
          } else {
            // Un video no se puede difuminar en canvas sin decodificarlo:
            // se avisa en vez de publicar algo que se veria en claro.
            toast.error(
              `No se pudo generar la miniatura de ${file.name}. Usa una imagen para publicaciones de pago.`,
            );
            setProgress(null);
            return;
          }
        }

        const size = await readImageSize(file);
        const attached = await attachPostAssetAction({
          postId,
          storageKey: signed.data.key,
          previewKey,
          mimeType: file.type || 'application/octet-stream',
          sizeBytes: file.size,
          width: size?.width,
          height: size?.height,
        });
        if (!attached.ok) {
          setProgress(null);
          toast.error(attached.error ?? 'No se pudo registrar el archivo.');
          return;
        }
      }

      setProgress('Publicando...');
      const published = await publishPostAction(postId);
      setProgress(null);

      if (published.ok) {
        toast.success(published.message ?? t('feed.published'));
        setBody('');
        setFiles([]);
        setVisibility('PUBLIC');
        router.refresh();
      } else {
        toast.error(published.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg">{t('feed.newPost')}</CardTitle>
        <CardDescription>{t('feed.blurNotice')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        <Textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t('feed.postPlaceholder')}
          rows={3}
          maxLength={2000}
        />

        {files.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {files.map((file, index) => (
              <div
                key={`${file.name}-${index}`}
                className="relative h-20 w-20 overflow-hidden rounded-lg border border-border bg-muted"
              >
                {file.type.startsWith('image/') ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={URL.createObjectURL(file)}
                    alt={file.name}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-[10px] text-muted-foreground">
                    {file.name.split('.').pop()?.toUpperCase()}
                  </div>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setFiles((prev) => prev.filter((_, i) => i !== index))
                  }
                  className="absolute right-1 top-1 rounded-full bg-black/70 p-0.5"
                  aria-label={t('common.close')}
                >
                  <X className="h-3 w-3 text-white" />
                </button>
              </div>
            ))}
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>{t('feed.visibility')}</Label>
            <Select
              value={visibility}
              onValueChange={(v) => setVisibility(v as Visibility)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="PUBLIC">Publica</SelectItem>
                <SelectItem value="LOCKED">De pago (borrosa)</SelectItem>
                <SelectItem value="SUBSCRIBERS" disabled={!subscriptionEnabled}>
                  Solo suscriptores
                  {!subscriptionEnabled && ' (activa la suscripcion)'}
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          {visibility === 'LOCKED' && (
            <div className="space-y-2">
              <Label htmlFor="postPrice">{t('feed.price')}</Label>
              <div className="relative">
                <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-token" />
                <Input
                  id="postPrice"
                  type="number"
                  min={1}
                  max={100000}
                  value={priceTokens}
                  onChange={(e) =>
                    setPriceTokens(Math.max(0, Number(e.target.value) || 0))
                  }
                  className="pl-9"
                />
              </div>
            </div>
          )}
        </div>

        <input
          ref={fileInput}
          type="file"
          accept="image/*,video/*"
          multiple
          hidden
          onChange={(e) => pickFiles(e.target.files)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            onClick={() => fileInput.current?.click()}
            disabled={isPending || files.length >= MAX_FILES}
          >
            <ImagePlus className="h-4 w-4" />
            {t('feed.addPhotos')}
          </Button>

          <Button variant="brand" onClick={publish} disabled={isPending}>
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : visibility === 'PUBLIC' ? (
              <Send className="h-4 w-4" />
            ) : (
              <Lock className="h-4 w-4" />
            )}
            {t('feed.publish')}
          </Button>

          {progress && (
            <span className="text-xs text-muted-foreground">{progress}</span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
