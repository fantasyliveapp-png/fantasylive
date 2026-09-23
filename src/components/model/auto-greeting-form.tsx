'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, ImagePlus, Loader2, Trash2 } from 'lucide-react';
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
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { useI18n } from '@/components/providers/i18n-provider';
import {
  removeGreetingAssetAction,
  requestGreetingUploadUrlAction,
  updateAutoGreetingAction,
} from '@/server/actions/greeting';
import { createBlurredPreview, putToSignedUrl } from '@/lib/blur-preview';

export function AutoGreetingForm({
  enabled: initialEnabled,
  text: initialText,
  priceTokens: initialPrice,
  dailyLimit: initialLimit,
  hasPhoto,
  photoPreviewUrl,
  sentToday,
}: {
  enabled: boolean;
  text: string;
  priceTokens: number;
  dailyLimit: number;
  hasPhoto: boolean;
  /** Miniatura difuminada de la foto ya guardada, si hay. */
  photoPreviewUrl: string | null;
  sentToday: number;
}) {
  const router = useRouter();
  const { t } = useI18n();
  const fileInput = useRef<HTMLInputElement | null>(null);

  const [enabled, setEnabled] = useState(initialEnabled);
  const [text, setText] = useState(initialText);
  const [priceTokens, setPriceTokens] = useState(initialPrice);
  const [dailyLimit, setDailyLimit] = useState(initialLimit);
  const [file, setFile] = useState<File | null>(null);
  const [isPending, startTransition] = useTransition();

  function save() {
    startTransition(async () => {
      let assetKey: string | undefined;
      let assetMime: string | undefined;
      let previewKey: string | undefined;

      if (file) {
        const signed = await requestGreetingUploadUrlAction({
          filename: file.name,
          contentType: file.type || 'image/jpeg',
        });
        if (!signed.ok || !signed.data) {
          toast.error(signed.error ?? 'No se pudo subir la foto.');
          return;
        }
        const uploaded = await putToSignedUrl(
          signed.data.uploadUrl,
          file,
          file.type || 'image/jpeg',
        );
        if (!uploaded) {
          toast.error('No se pudo subir la foto.');
          return;
        }
        assetKey = signed.data.key;
        assetMime = file.type || 'image/jpeg';

        // La miniatura difuminada es lo que se ve en el chat antes de pagar.
        // Se genera aqui, en el navegador, igual que en el feed.
        const preview = await createBlurredPreview(file);
        if (preview) {
          const signedPreview = await requestGreetingUploadUrlAction({
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
        }
      }

      const result = await updateAutoGreetingAction({
        enabled,
        text: text.trim() || undefined,
        priceTokens,
        dailyLimit,
        assetKey,
        assetMime,
        previewKey,
      });

      if (result.ok) {
        toast.success(result.message ?? t('greeting.saved'));
        setFile(null);
        router.refresh();
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  function removePhoto() {
    startTransition(async () => {
      const result = await removeGreetingAssetAction();
      if (result.ok) {
        toast.success(result.message ?? '');
        setFile(null);
        router.refresh();
      } else {
        toast.error(result.error ?? t('common.somethingWentWrong'));
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('greeting.title')}</CardTitle>
        <CardDescription>{t('greeting.description')}</CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="flex items-center justify-between gap-4 rounded-lg border border-border p-4">
          <div>
            <Label htmlFor="greetingEnabled">{t('greeting.enable')}</Label>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t('greeting.sentToday', { sent: sentToday, limit: dailyLimit })}
            </p>
          </div>
          <Switch
            id="greetingEnabled"
            checked={enabled}
            onCheckedChange={setEnabled}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="greetingText">{t('greeting.text')}</Label>
          <Textarea
            id="greetingText"
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={t('greeting.textPlaceholder')}
            rows={3}
            maxLength={600}
          />
        </div>

        <div className="space-y-2">
          <Label>{t('greeting.photo')}</Label>

          <div className="flex flex-wrap items-center gap-3">
            {(file || photoPreviewUrl) && (
              <div className="h-20 w-20 overflow-hidden rounded-lg border border-border bg-muted">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={file ? URL.createObjectURL(file) : (photoPreviewUrl ?? '')}
                  alt=""
                  className="h-full w-full object-cover"
                />
              </div>
            )}

            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
            <Button
              variant="outline"
              onClick={() => fileInput.current?.click()}
              disabled={isPending}
            >
              <ImagePlus className="h-4 w-4" />
              {hasPhoto || file ? 'Cambiar foto' : t('greeting.photo')}
            </Button>

            {hasPhoto && !file && (
              <Button
                variant="ghost"
                onClick={removePhoto}
                disabled={isPending}
              >
                <Trash2 className="h-4 w-4" />
                Quitar
              </Button>
            )}
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="greetingPrice">{t('greeting.photoPrice')}</Label>
            <div className="relative">
              <Coins className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-token" />
              <Input
                id="greetingPrice"
                type="number"
                min={0}
                max={100000}
                value={priceTokens}
                onChange={(e) =>
                  setPriceTokens(Math.max(0, Number(e.target.value) || 0))
                }
                className="pl-9"
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {t('greeting.freePhoto')}
            </p>
          </div>

          <div className="space-y-2">
            <Label htmlFor="greetingLimit">{t('greeting.dailyLimit')}</Label>
            <Input
              id="greetingLimit"
              type="number"
              min={0}
              max={500}
              value={dailyLimit}
              onChange={(e) =>
                setDailyLimit(Math.max(0, Number(e.target.value) || 0))
              }
            />
            <p className="text-xs text-muted-foreground">
              Se envia una sola vez a cada persona, y como maximo a estas al
              dia.
            </p>
          </div>
        </div>

        <Button variant="brand" onClick={save} disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {t('common.save')}
        </Button>
      </CardContent>
    </Card>
  );
}
