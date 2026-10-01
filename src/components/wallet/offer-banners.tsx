'use client';

import { useEffect, useState } from 'react';
import { Clock, Gift } from 'lucide-react';

import type { OfferBanner } from '@/lib/token-offers';

/** "1 h 05 min" / "12:04" hasta el final de la oferta. */
function left(ms: number) {
  if (ms <= 0) return 'termina ya';
  const totalMin = Math.floor(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h >= 48) return `quedan ${Math.floor(h / 24)} días`;
  if (h > 0) return `quedan ${h} h ${String(m).padStart(2, '0')} min`;
  const s = Math.floor((ms % 60_000) / 1000);
  return `quedan ${m}:${String(s).padStart(2, '0')}`;
}

/** Ofertas en curso del fan, con cuenta atras si caducan. */
export function OfferBanners({ banners }: { banners: OfferBanner[] }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!banners.some((b) => b.endsAt)) return;
    const t = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(t);
  }, [banners]);

  if (banners.length === 0) return null;
  return (
    <div className="mt-5 space-y-2">
      {banners.map((b) => (
        <div
          key={b.kind}
          className="flex flex-wrap items-center gap-3 rounded-2xl bg-gradient-to-r from-fantazy-red/20 via-champagne-gold/10 to-transparent p-4 ring-1 ring-champagne-gold/30"
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-fantazy-red to-champagne-gold text-white">
            <Gift className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="font-semibold">{b.title}</p>
            <p className="text-sm text-muted-foreground">{b.text}</p>
          </div>
          {b.endsAt && (
            <span className="flex items-center gap-1 rounded-full bg-black/30 px-3 py-1 text-xs font-semibold tabular-nums text-champagne-gold">
              <Clock className="h-3.5 w-3.5" />
              {left(new Date(b.endsAt).getTime() - now)}
            </span>
          )}
        </div>
      ))}
      <p className="text-xs text-muted-foreground">
        Las ofertas no se suman: en cada paquete ya ves la que más te conviene.
      </p>
    </div>
  );
}
