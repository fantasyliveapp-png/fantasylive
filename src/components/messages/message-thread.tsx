'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Coins, Gift, Loader2, Lock, Paperclip, Play, Send, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  requestMessageAttachmentUploadUrlAction,
  sendMessageAction,
  sendMessageAttachmentAction,
  unlockDealChatAction,
  unlockMessageAttachmentAction,
} from '@/server/actions/messages';
import { DealCard, type DealView } from '@/components/messages/deal-cards';
import { MediaViewer } from '@/components/content/media-viewer';
import { VaultPicker } from '@/components/vault/vault-picker';
import { cn, relativeTime } from '@/lib/utils';

export interface MessageAttachmentFileView {
  id: string;
  mimeType: string;
  /** Original: solo si esta desbloqueado (o lo envio quien mira). */
  url: string | null;
  /** Miniatura borrosa: lo que se ve antes de pagar. */
  previewUrl: string | null;
}

/** Un envio: uno o varios archivos con un solo precio. */
export interface MessageAttachmentView {
  id: string;
  mimeType: string;
  priceTokens: number;
  /** Precio sin la oferta del creador (para tacharlo), si la hay. */
  originalPriceTokens?: number | null;
  offerLabel?: string | null;
  locked: boolean;
  /** Para quien lo envio: si ya se lo compraron (null = gratis o no es suyo). */
  sold: boolean | null;
  photos: number;
  videos: number;
  files: MessageAttachmentFileView[];
}

/** Pedido que se esta entregando en este chat. */
type DeliveringRequest = { id: string; description: string };

const MAX_FILES = 10;

export interface MessageRow {
  id: string;
  body: string | null;
  createdAt: string;
  isMine: boolean;
  /// Generado por el asistente de un perfil de IA. Se etiqueta siempre: la
  /// mensajeria se cobra y el usuario tiene que saber que no le responde una
  /// persona.
  isAiGenerated: boolean;
  /** Entrega de un pedido a medida (ya pagado). */
  isRequestDelivery?: boolean;
  attachment: MessageAttachmentView | null;
}

/**
 * Hilo de un chat fan <-> creadora (con adjuntos y fotos de pago). Se ve
 * igual que el chat entre personas: burbujas, caja de escribir fija abajo y
 * mensajes nuevos cada pocos segundos mientras la pestana esta visible.
 */
export function MessageThread({
  conversationId,
  messages,
  canSend,
  disabledReason,
  isModel = false,
  deals = [],
  unlockChat,
}: {
  conversationId: string;
  messages: MessageRow[];
  canSend: boolean;
  disabledReason?: string;
  isModel?: boolean;
  /** Pedidos y citas con este fan: tarjetas dentro del hilo. */
  deals?: DealView[];
  /** Fan con el chat abierto solo por un pedido/cita: abrirlo para escribir. */
  unlockChat?: { priceTokens: number } | null;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pendingFiles, setPendingFiles] = useState<{ file: File; url: string }[]>([]);
  const [price, setPrice] = useState(0);
  // Pedido que se esta entregando: lo que se envie va gratis y lo cierra.
  const [delivering, setDelivering] = useState<DeliveringRequest | null>(null);
  const [isUnlocking, startUnlock] = useTransition();

  // Mensajes y tarjetas de pedidos/citas, en orden de fecha.
  const timeline = [
    ...messages.map((m) => ({ key: `m-${m.id}`, at: m.createdAt, message: m, deal: null as DealView | null })),
    ...deals.map((d) => ({ key: `d-${d.kind}-${d.id}`, at: d.createdAt, message: null as MessageRow | null, deal: d })),
  ].sort((a, b) => a.at.localeCompare(b.at));
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const bottom = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    bottom.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  // Sin tiempo real todavia: se buscan mensajes nuevos cada 5 s.
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') router.refresh();
    }, 5000);
    return () => clearInterval(timer);
  }, [router]);

  function send() {
    if (body.trim().length === 0) return;
    startTransition(async () => {
      const result = await sendMessageAction({ conversationId, body });
      if (result.ok) {
        setBody('');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo enviar');
      }
    });
  }

  function pickFile() {
    fileInputRef.current?.click();
  }

  function onFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const picked = [...(e.target.files ?? [])].filter((f) => /^(image|video)\//.test(f.type));
    if (picked.length) {
      setPendingFiles((prev) => {
        const room = MAX_FILES - prev.length;
        if (picked.length > room) toast.error(`Maximo ${MAX_FILES} archivos por envio.`);
        return [...prev, ...picked.slice(0, Math.max(room, 0)).map((file) => ({ file, url: URL.createObjectURL(file) }))];
      });
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  function clearFiles() {
    for (const f of pendingFiles) URL.revokeObjectURL(f.url);
    setPendingFiles([]);
    setPrice(0);
  }

  async function sendAttachment() {
    if (pendingFiles.length === 0) return;
    setUploading(true);
    try {
      const uploaded: { storageKey: string; mimeType: string; sizeBytes: number }[] = [];
      for (const { file } of pendingFiles) {
        const type = file.type || 'application/octet-stream';
        const urlResult = await requestMessageAttachmentUploadUrlAction({
          conversationId,
          filename: file.name,
          contentType: type,
        });
        if (!urlResult.ok || !urlResult.data) {
          toast.error(urlResult.error ?? 'No se pudo preparar la subida');
          return;
        }
        const upload = await fetch(urlResult.data.uploadUrl, {
          method: 'PUT',
          body: file,
          headers: { 'Content-Type': type },
        });
        if (!upload.ok) {
          toast.error(`Fallo al subir ${file.name}`);
          return;
        }
        uploaded.push({ storageKey: urlResult.data.key, mimeType: type, sizeBytes: file.size });
      }

      const result = await sendMessageAttachmentAction({
        conversationId,
        files: uploaded,
        priceTokens: delivering ? 0 : price,
        body: body.trim() || undefined,
        requestId: delivering?.id,
      });
      if (result.ok) {
        toast.success(result.message ?? 'Enviado');
        clearFiles();
        setBody('');
        setDelivering(null);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo enviar');
      }
    } catch {
      toast.error('Error subiendo los archivos');
    } finally {
      setUploading(false);
    }
  }

  function unlock(attachmentId: string) {
    startTransition(async () => {
      const result = await unlockMessageAttachmentAction(attachmentId);
      if (result.ok) {
        toast.success(result.message ?? 'Archivo desbloqueado');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo desbloquear');
      }
    });
  }

  return (
    <div className="flex flex-col gap-3">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="hidden"
        onChange={onFileSelected}
      />

      <div className="space-y-2 pb-2">
        {timeline.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Todavia no hay mensajes.
          </p>
        ) : (
          timeline.map(({ key, message: m, deal }) =>
            deal ? (
              <DealCard
                key={key}
                deal={deal}
                isCreator={isModel}
                onDeliver={(d) => {
                  setDelivering({ id: d.id, description: d.description });
                  bottom.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
                }}
              />
            ) : m ? (
            <div key={m.id} className={cn('flex', m.isMine ? 'justify-end' : 'justify-start')}>
              <div
                className={cn(
                  'max-w-[80%] space-y-1.5 rounded-2xl px-3.5 py-2 text-sm',
                  m.isMine
                    ? 'rounded-br-md bg-primary text-primary-foreground'
                    : 'rounded-bl-md bg-muted text-foreground',
                )}
              >
                {m.isRequestDelivery && (
                  <p className="flex items-center gap-1 text-[11px] font-semibold opacity-90">
                    <Gift className="h-3.5 w-3.5" /> Pedido entregado
                  </p>
                )}
                {m.attachment && (
                  <AttachmentBubble
                    attachment={m.attachment}
                    onUnlock={() => unlock(m.attachment!.id)}
                    isPending={isPending}
                  />
                )}
                {m.body && <p className="whitespace-pre-wrap break-words">{m.body}</p>}
                <p
                  className={cn(
                    'flex items-center justify-end gap-1.5 text-[10px]',
                    m.isMine ? 'text-primary-foreground/70' : 'text-muted-foreground',
                  )}
                >
                  {m.isAiGenerated && (
                    <span className="rounded bg-foreground/15 px-1 py-px font-semibold uppercase tracking-wide">
                      IA
                    </span>
                  )}
                  {relativeTime(m.createdAt)}
                </p>
              </div>
            </div>
            ) : null,
          )
        )}
        <div ref={bottom} />
      </div>

      {canSend ? (
        <div className="sticky bottom-16 space-y-2 rounded-2xl border border-border/60 bg-background/95 p-2 backdrop-blur md:bottom-4">
          {delivering && (
            <div className="flex items-start gap-2 rounded-xl border border-champagne-gold/40 bg-champagne-gold/10 p-2.5 text-xs">
              <Gift className="mt-0.5 h-4 w-4 shrink-0 text-champagne-gold" />
              <span className="min-w-0 flex-1">
                <span className="font-semibold text-foreground">Entregando pedido:</span>{' '}
                <span className="text-muted-foreground">{delivering.description}</span>
                <span className="mt-0.5 block text-muted-foreground">
                  Adjunta con el clip o desde la Boveda. Va gratis: ya lo pago.
                </span>
              </span>
              <button
                type="button"
                onClick={() => setDelivering(null)}
                className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                aria-label="Cancelar entrega"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          {pendingFiles.length > 0 && (
            <div className="space-y-2 rounded-xl border border-border/60 bg-muted/30 p-2.5">
              <div className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                {pendingFiles.map((f, i) => (
                  <div key={f.url} className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
                    {f.file.type.startsWith('video/') ? (
                      <video src={f.url} muted className="h-full w-full object-cover" />
                    ) : (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={f.url} alt="" className="h-full w-full object-cover" />
                    )}
                    <button
                      type="button"
                      onClick={() => {
                        URL.revokeObjectURL(f.url);
                        setPendingFiles((prev) => prev.filter((_, j) => j !== i));
                      }}
                      disabled={uploading}
                      className="absolute right-0.5 top-0.5 rounded-full bg-black/70 p-0.5 text-white"
                      aria-label="Quitar"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
                {pendingFiles.length < MAX_FILES && (
                  <button
                    type="button"
                    onClick={pickFile}
                    disabled={uploading}
                    className="flex h-14 w-14 shrink-0 items-center justify-center rounded-lg border border-dashed border-border text-muted-foreground"
                    aria-label="Añadir mas"
                  >
                    +
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {delivering ? (
                  <span className="flex-1 text-xs text-muted-foreground">Gratis · entrega del pedido</span>
                ) : (
                  <label className="flex flex-1 items-center gap-1.5 text-xs text-muted-foreground">
                    Precio de todo
                    <Input
                      type="number"
                      min={0}
                      value={price}
                      onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
                      className="h-7 w-20 text-xs"
                    />
                    {price > 0 ? 'tokens' : 'gratis'}
                  </label>
                )}
                <Button size="sm" variant="ghost" onClick={clearFiles} disabled={uploading}>
                  Quitar
                </Button>
                <Button size="sm" variant="brand" onClick={sendAttachment} disabled={uploading}>
                  {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  {delivering ? 'Entregar' : 'Enviar'} {pendingFiles.length}
                </Button>
              </div>
            </div>
          )}

          <div className="flex items-end gap-2">
            {isModel && (
              <Button
                variant="ghost"
                size="icon"
                onClick={pickFile}
                disabled={isPending || uploading}
                aria-label="Adjuntar foto o video"
              >
                <Paperclip className="h-4 w-4" />
              </Button>
            )}
            {isModel && (
              <VaultPicker
                conversationId={conversationId}
                requestId={delivering?.id}
                onSent={() => {
                  setDelivering(null);
                  router.refresh();
                }}
              />
            )}
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              rows={1}
              maxLength={1000}
              placeholder="Escribe un mensaje..."
              disabled={isPending}
              className="max-h-32 min-h-10 w-full resize-none bg-transparent px-2 py-2 text-sm outline-none"
            />
            <Button
              variant="brand"
              size="icon"
              onClick={send}
              disabled={isPending || body.trim().length === 0}
              aria-label="Enviar"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : unlockChat ? (
        <div className="space-y-2 rounded-2xl border border-border/60 bg-muted/40 p-3 text-center text-xs text-muted-foreground">
          <p>Aquí gestionas tus pedidos y reservas. Para escribirle mensajes, abre el chat.</p>
          <Button
            size="sm"
            variant="brand"
            disabled={isUnlocking}
            onClick={() =>
              startUnlock(async () => {
                const r = await unlockDealChatAction(conversationId);
                if (r.ok) {
                  toast.success(r.message ?? 'Chat abierto');
                  router.refresh();
                } else toast.error(r.error ?? 'No se pudo abrir el chat');
              })
            }
          >
            {isUnlocking && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {unlockChat.priceTokens > 0 ? `Abrir chat · ${unlockChat.priceTokens} tokens` : 'Abrir chat'}
          </Button>
        </div>
      ) : (
        disabledReason && (
          <p className="rounded-2xl border border-border/60 bg-muted/40 p-3 text-center text-xs text-muted-foreground">
            {disabledReason}
          </p>
        )
      )}
    </div>
  );
}

function AttachmentBubble({
  attachment,
  onUnlock,
  isPending,
}: {
  attachment: MessageAttachmentView;
  onUnlock: () => void;
  isPending: boolean;
}) {
  const [viewer, setViewer] = useState<number | null>(null);
  const files = attachment.files;
  const shown = files.slice(0, 4);
  const extra = files.length - shown.length;
  const summary = [
    attachment.photos ? `${attachment.photos} ${attachment.photos === 1 ? 'foto' : 'fotos'}` : '',
    attachment.videos ? `${attachment.videos} ${attachment.videos === 1 ? 'video' : 'videos'}` : '',
  ]
    .filter(Boolean)
    .join(' · ');

  const grid = (
    <div className={cn('grid w-60 max-w-full gap-1', files.length > 1 ? 'grid-cols-2' : 'grid-cols-1')}>
      {shown.map((f, i) => {
        const isVideo = f.mimeType.startsWith('video');
        const src = attachment.locked ? f.previewUrl : f.url;
        return (
          <button
            key={f.id}
            type="button"
            disabled={attachment.locked}
            onClick={() => setViewer(i)}
            className={cn(
              'relative overflow-hidden rounded-lg bg-black/30',
              files.length === 1 ? 'aspect-[4/5]' : 'aspect-square',
            )}
          >
            {src &&
              (isVideo && !attachment.locked ? (
                <video src={src} muted preload="metadata" className="h-full w-full object-cover" />
              ) : (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={src}
                  alt=""
                  className={cn('h-full w-full object-cover', attachment.locked && 'scale-110 blur-md')}
                />
              ))}
            {isVideo && <Play className="absolute left-1.5 top-1.5 h-4 w-4 text-white drop-shadow" />}
            {i === shown.length - 1 && extra > 0 && (
              <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-lg font-bold text-white">
                +{extra}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );

  if (attachment.locked) {
    return (
      <div className="relative">
        {grid}
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-black/35 p-3 text-center text-white">
          <Lock className="h-5 w-5" />
          <p className="text-xs font-semibold drop-shadow">{summary}</p>
          {attachment.offerLabel && (
            <span className="rounded-full bg-gradient-to-r from-fantazy-red to-champagne-gold px-2 py-0.5 text-[10px] font-bold">
              {attachment.offerLabel} · antes {attachment.originalPriceTokens}
            </span>
          )}
          <Button size="sm" variant="token" onClick={onUnlock} disabled={isPending}>
            {isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Coins className="h-3.5 w-3.5" />}
            Desbloquear por {attachment.priceTokens}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <>
      {grid}
      {(files.length > 1 || attachment.sold !== null) && (
        <p className="flex items-center gap-1.5 text-[11px] opacity-80">
          {files.length > 1 && <span>{summary}</span>}
          {attachment.sold !== null && (
            <span className="ml-auto inline-flex items-center gap-1 rounded-full bg-black/20 px-1.5 py-0.5 font-semibold">
              {attachment.sold ? <Check className="h-3 w-3" /> : <Lock className="h-3 w-3" />}
              {attachment.priceTokens} tk · {attachment.sold ? 'comprado' : 'sin comprar'}
            </span>
          )}
        </p>
      )}
      {viewer !== null && (
        <MediaViewer files={files} index={viewer} onIndex={setViewer} onClose={() => setViewer(null)} />
      )}
    </>
  );
}
