'use client';

import { Share2 } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';

export function ShareProfileButton({ slug }: { slug: string }) {
  async function share() {
    const url = `${window.location.origin}/models/${slug}`;
    try {
      if (navigator.share) {
        await navigator.share({ url });
        return;
      }
      await navigator.clipboard.writeText(url);
      toast.success('Enlace copiado.');
    } catch {
      // el usuario cancelo el dialogo nativo de compartir; no es un error
    }
  }

  return (
    <Button variant="ghost" size="icon" onClick={share} aria-label="Compartir perfil">
      <Share2 className="h-4 w-4" />
    </Button>
  );
}
