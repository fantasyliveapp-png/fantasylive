'use client';

import { useState } from 'react';
import { Check, Copy, Share2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

/** Un enlace de referidos con copiar y compartir (en el movil, el menu nativo). */
export function ReferralLink({ url, shareText }: { url: string; shareText: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast.success('Enlace copiado');
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('No se pudo copiar. Mantenlo pulsado para copiarlo.');
    }
  }

  async function share() {
    if (navigator.share) {
      try {
        await navigator.share({ url, text: shareText });
        return;
      } catch {
        return; // cancelado
      }
    }
    void copy();
  }

  return (
    <div className="flex items-center gap-2 rounded-xl border border-border/60 bg-background/60 p-1.5 pl-3">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground">{url}</span>
      <Button size="sm" variant="ghost" onClick={copy} aria-label="Copiar enlace">
        {copied ? <Check className="h-4 w-4 text-state-connected" /> : <Copy className="h-4 w-4" />}
      </Button>
      <Button size="sm" variant="brand" onClick={share}>
        <Share2 className="h-4 w-4" />
        Compartir
      </Button>
    </div>
  );
}
