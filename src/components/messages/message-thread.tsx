'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Coins, Loader2, Lock, Paperclip, Send, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import {
  requestMessageAttachmentUploadUrlAction,
  sendMessageAction,
  sendMessageAttachmentAction,
  unlockMessageAttachmentAction,
} from '@/server/actions/messages';
import { cn, relativeTime } from '@/lib/utils';

export interface MessageAttachmentView {
  id: string;
  mimeType: string;
  priceTokens: number;
  locked: boolean;
  url: string | null;
}

export interface MessageRow {
  id: string;
  body: string | null;
  createdAt: string;
  isMine: boolean;
  attachment: MessageAttachmentView | null;
}

export function MessageThread({
  conversationId,
  messages,
  canSend,
  disabledReason,
  isModel = false,
}: {
  conversationId: string;
  messages: MessageRow[];
  canSend: boolean;
  disabledReason?: string;
  isModel?: boolean;
}) {
  const router = useRouter();
  const [body, setBody] = useState('');
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [price, setPrice] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [isPending, startTransition] = useTransition();
  const fileInputRef = useRef<HTMLInputElement>(null);

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
    const file = e.target.files?.[0];
    if (file) {
      setPendingFile(file);
      setPrice(0);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  }

  async function sendAttachment() {
    if (!pendingFile) return;
    setUploading(true);
    try {
      const urlResult = await requestMessageAttachmentUploadUrlAction({
        conversationId,
        filename: pendingFile.name,
        contentType: pendingFile.type || 'application/octet-stream',
      });
      if (!urlResult.ok || !urlResult.data) {
        toast.error(urlResult.error ?? 'No se pudo preparar la subida');
        return;
      }

      const upload = await fetch(urlResult.data.uploadUrl, {
        method: 'PUT',
        body: pendingFile,
        headers: { 'Content-Type': pendingFile.type || 'application/octet-stream' },
      });
      if (!upload.ok) {
        toast.error('Fallo al subir el archivo');
        return;
      }

      const result = await sendMessageAttachmentAction({
        conversationId,
        storageKey: urlResult.data.key,
        mimeType: pendingFile.type || 'application/octet-stream',
        sizeBytes: pendingFile.size,
        priceTokens: price,
      });
      if (result.ok) {
        toast.success(result.message ?? 'Archivo enviado');
        setPendingFile(null);
        setPrice(0);
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo enviar el archivo');
      }
    } catch {
      toast.error('Error subiendo el archivo');
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
    <div className="flex h-[65vh] flex-col rounded-xl border border-border">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        className="hidden"
        onChange={onFileSelected}
      />

      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 ? (
          <p className="py-10 text-center text-sm text-muted-foreground">
            Todavia no hay mensajes.
          </p>
        ) : (
          messages.map((m) => (
            <div
              key={m.id}
              className={cn('flex', m.isMine ? 'justify-end' : 'justify-start')}
            >
              <div
                className={cn(
                  'max-w-[75%] space-y-1.5 rounded-lg px-3 py-2 text-sm',
                  m.isMine
                    ? 'bg-primary text-primary-foreground'
                    : 'bg-muted text-foreground',
                )}
              >
                {m.attachment && (
                  <AttachmentBubble
                    attachment={m.attachment}
                    onUnlock={() => unlock(m.attachment!.id)}
                    isPending={isPending}
                  />
                )}
                {m.body && <p className="whitespace-pre-line">{m.body}</p>}
                <p
                  className={cn(
                    'text-[10px] opacity-70',
                    m.isMine ? 'text-right' : 'text-left',
                  )}
                >
                  {relativeTime(m.createdAt)}
                </p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="border-t border-border p-3">
        {!canSend && disabledReason && (
          <p className="mb-2 text-xs text-destructive">{disabledReason}</p>
        )}

        {pendingFile && (
          <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-border bg-muted/30 p-2.5">
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {pendingFile.name}
            </span>
            <div className="flex items-center gap-1.5">
              <Label htmlFor="attachPrice" className="text-xs text-muted-foreground">
                Precio
              </Label>
              <Input
                id="attachPrice"
                type="number"
                min={0}
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                className="h-7 w-20 text-xs"
              />
              <span className="text-xs text-muted-foreground">
                {price > 0 ? 'tokens' : 'gratis'}
              </span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setPendingFile(null)}
              disabled={uploading}
            >
              <X className="h-3.5 w-3.5" />
            </Button>
            <Button
              size="sm"
              variant="brand"
              onClick={sendAttachment}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Send className="h-3.5 w-3.5" />
              )}
              Enviar archivo
            </Button>
          </div>
        )}

        <div className="flex items-end gap-2">
          {isModel && (
            <Button
              variant="outline"
              size="icon"
              onClick={pickFile}
              disabled={isPending || uploading}
              aria-label="Adjuntar archivo"
            >
              <Paperclip className="h-4 w-4" />
            </Button>
          )}
          <Textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder={canSend ? 'Escribi un mensaje...' : 'No podes escribir ahora'}
            disabled={!canSend || isPending}
            className="resize-none"
          />
          <Button
            variant="brand"
            size="icon"
            onClick={send}
            disabled={!canSend || isPending || body.trim().length === 0}
          >
            {isPending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
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
  if (attachment.locked) {
    return (
      <div className="flex w-56 flex-col items-center gap-2 rounded-lg bg-black/20 p-4 text-center">
        <Lock className="h-5 w-5" />
        <p className="text-xs">Archivo bloqueado</p>
        <Button size="sm" variant="token" onClick={onUnlock} disabled={isPending}>
          {isPending ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Coins className="h-3.5 w-3.5" />
          )}
          Desbloquear por {attachment.priceTokens}
        </Button>
      </div>
    );
  }

  if (!attachment.url) return null;

  return attachment.mimeType.startsWith('video') ? (
    <video src={attachment.url} controls className="max-w-full rounded-lg" />
  ) : (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={attachment.url} alt="" className="max-w-full rounded-lg" />
  );
}
