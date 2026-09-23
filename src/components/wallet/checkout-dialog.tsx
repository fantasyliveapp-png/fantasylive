'use client';

import { Coins, ExternalLink, Loader2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useTranslate } from '@/components/providers/i18n-provider';

/**
 * Espera mientras el usuario paga en la pestana de la pasarela.
 *
 * Vive en su propio fichero porque `token-packages` lo carga con next/dynamic:
 * Radix Dialog son ~20 kB que solo hacen falta cuando alguien pulsa Comprar, y
 * no tiene sentido servirselos a todo el que abre el monedero a mirar el saldo.
 */
export function CheckoutDialog({
  blocked,
  onClose,
  onReopen,
}: {
  blocked: boolean;
  onClose: () => void;
  onReopen: () => void;
}) {
  const t = useTranslate();

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('wallet.checkoutTitle')}</DialogTitle>
          <DialogDescription>
            {blocked ? t('wallet.checkoutBlocked') : t('wallet.checkoutBody')}
          </DialogDescription>
        </DialogHeader>

        <div className="flex flex-col items-center gap-5 py-6">
          <div className="relative flex h-20 w-20 items-center justify-center">
            {/* Dos ondas desfasadas: lee como "esperando", no como "cargando". */}
            <span className="absolute inset-0 animate-pulse-ring rounded-full bg-token/40" />
            <span
              className="absolute inset-0 animate-pulse-ring rounded-full bg-token/30"
              style={{ animationDelay: '900ms' }}
            />
            <span className="relative flex h-16 w-16 items-center justify-center rounded-full bg-token/15">
              <Coins className="h-7 w-7 text-token" />
            </span>
          </div>

          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('wallet.checkoutWaiting')}
          </p>
        </div>

        <Button variant="outline" className="w-full gap-2" onClick={onReopen}>
          <ExternalLink className="h-4 w-4" />
          {t('wallet.reopen')}
        </Button>
      </DialogContent>
    </Dialog>
  );
}
