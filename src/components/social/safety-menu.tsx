'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Ban, EyeOff, Flag, Loader2, MoreHorizontal, ShieldCheck } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { toggleBlockUserAction } from '@/server/actions/chat';
import { reportUserAction } from '@/server/actions/safety';

const REASONS = [
  { value: 'HARASSMENT', label: 'Acoso o insultos' },
  { value: 'SPAM', label: 'Spam o estafa' },
  { value: 'IMPERSONATION', label: 'Se hace pasar por otra persona' },
  { value: 'UNDERAGE', label: 'Parece menor de edad' },
  { value: 'NON_CONSENSUAL', label: 'Contenido sin consentimiento' },
  { value: 'OTHER', label: 'Otro motivo' },
] as const;

type Reason = (typeof REASONS)[number]['value'];

/**
 * Menu "···" de seguridad: denunciar y bloquear. Va en perfiles,
 * publicaciones y chats; `context` dice que se denuncia (el perfil, una
 * publicacion o un chat) para que el equipo lo revise con contexto.
 */
export function SafetyMenu({
  targetUserId,
  targetName,
  context = 'profile',
  reportLabel = 'Denunciar',
  initialBlocked = false,
  isAuthenticated,
  className,
  onBlockedChange,
  onNotInterested,
}: {
  targetUserId: string;
  targetName: string;
  context?: string;
  reportLabel?: string;
  initialBlocked?: boolean;
  isAuthenticated: boolean;
  className?: string;
  onBlockedChange?: (blocked: boolean) => void;
  /** En publicaciones: opcion "No me interesa" encima de denunciar. */
  onNotInterested?: () => void;
}) {
  const router = useRouter();
  const [blocked, setBlocked] = useState(initialBlocked);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<Reason | null>(null);
  const [details, setDetails] = useState('');
  const [isPending, startTransition] = useTransition();

  function requireAuth() {
    if (isAuthenticated) return true;
    router.push('/login');
    return false;
  }

  function toggleBlock() {
    if (!requireAuth()) return;
    if (!blocked && !window.confirm(`¿Bloquear a ${targetName}? No podreis escribiros ni seguiros.`)) {
      return;
    }
    startTransition(async () => {
      const result = await toggleBlockUserAction(targetUserId);
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo completar.');
        return;
      }
      setBlocked(Boolean(result.blocked));
      onBlockedChange?.(Boolean(result.blocked));
      toast.success(result.message ?? (result.blocked ? 'Bloqueado' : 'Desbloqueado'));
      router.refresh();
    });
  }

  function sendReport() {
    if (!reason) return;
    startTransition(async () => {
      const result = await reportUserAction({
        reportedUserId: targetUserId,
        reason,
        details: details.trim() || undefined,
        context,
      });
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo enviar la denuncia.');
        return;
      }
      toast.success(result.message ?? 'Denuncia enviada');
      setReporting(false);
      setReason(null);
      setDetails('');
    });
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant="ghost"
            size="icon"
            className={cn('shrink-0', className)}
            aria-label="Mas opciones"
          >
            <MoreHorizontal className="h-5 w-5" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-56">
          {onNotInterested && (
            <DropdownMenuItem onClick={onNotInterested}>
              <EyeOff /> No me interesa
            </DropdownMenuItem>
          )}
          <DropdownMenuItem
            onClick={() => {
              if (requireAuth()) setReporting(true);
            }}
          >
            <Flag /> {reportLabel}
          </DropdownMenuItem>
          <DropdownMenuItem
            onClick={toggleBlock}
            className={blocked ? undefined : 'text-destructive focus:text-destructive'}
          >
            {blocked ? <ShieldCheck /> : <Ban />}
            {blocked ? `Desbloquear a ${targetName}` : `Bloquear a ${targetName}`}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={reporting} onOpenChange={setReporting}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{reportLabel}</DialogTitle>
            <DialogDescription>
              Es anonimo: {targetName} no sabra quien lo denuncio. Si hay peligro
              inmediato, contacta tambien con las autoridades.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-1.5" role="radiogroup" aria-label="Motivo">
            {REASONS.map((r) => (
              <button
                key={r.value}
                type="button"
                role="radio"
                aria-checked={reason === r.value}
                onClick={() => setReason(r.value)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left text-sm transition-colors',
                  reason === r.value
                    ? 'border-primary bg-primary/10'
                    : 'border-border/60 hover:border-muted-foreground/50',
                )}
              >
                <span
                  className={cn(
                    'flex h-4 w-4 shrink-0 items-center justify-center rounded-full border',
                    reason === r.value ? 'border-primary' : 'border-muted-foreground/50',
                  )}
                >
                  {reason === r.value && <span className="h-2 w-2 rounded-full bg-primary" />}
                </span>
                {r.label}
              </button>
            ))}
          </div>

          <textarea
            value={details}
            onChange={(e) => setDetails(e.target.value)}
            maxLength={1000}
            rows={3}
            placeholder="Cuentanos que paso (opcional)"
            className="w-full resize-none rounded-xl border border-border/60 bg-muted/40 p-3 text-sm outline-none focus:border-primary"
          />

          <Button variant="brand" onClick={sendReport} disabled={!reason || isPending}>
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Flag className="h-4 w-4" />}
            Enviar denuncia
          </Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
