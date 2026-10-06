import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Check, MessageCircle, ShieldCheck } from 'lucide-react';

import { DistributorBadge } from '@/components/distributors/distributor-badge';
import { ContactDistributorButton } from '@/components/distributors/distributor-forms';
import {
  Countdown,
  DisputeForm,
  FanPayForm,
  RateSale,
  ReleaseButtons,
  ResolveDispute,
} from '@/components/distributors/p2p';
import { requireUser } from '@/lib/auth/guards';
import { formatLocal, paymentMethodLabel } from '@/lib/distributor-shared';
import { expireSales } from '@/lib/distributors';
import { prisma } from '@/lib/prisma';
import { resolveAssetUrl } from '@/lib/storage';
import { cn, formatDateTime, formatTokens } from '@/lib/utils';

export const metadata: Metadata = { title: 'Compra de tokens' };
export const dynamic = 'force-dynamic';

const STEPS = ['Pedido creado', 'Pago', 'Confirmación', 'Tokens entregados'] as const;

/** Una compra protegida entre fan y distribuidor: la ven los dos (y el equipo). */
export default async function SalePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser(`/compra-tokens/${id}`);
  await expireSales();
  const sale = await prisma.distributorSale.findUnique({
    where: { id },
    include: {
      account: true,
      distributor: { select: { id: true, userId: true, legalName: true } },
      fan: { select: { id: true, username: true, name: true } },
    },
  });
  if (!sale) notFound();
  const isFan = sale.fanId === user.id;
  const isDist = sale.distributor.userId === user.id;
  const isAdmin = user.role === 'ADMIN';
  if (!isFan && !isDist && !isAdmin) notFound();

  // El comprobante lo ven el distribuidor y el equipo (y el propio fan).
  const proofUrl = sale.paymentProofKey ? await resolveAssetUrl(sale.paymentProofKey, { isPublic: false }) : null;
  const evidenceUrl = sale.disputeEvidenceKey ? await resolveAssetUrl(sale.disputeEvidenceKey, { isPublic: false }) : null;
  const step =
    sale.status === 'AWAITING_PAYMENT' ? 1 : sale.status === 'PAID' || sale.status === 'DISPUTED' ? 2 : sale.status === 'COMPLETED' ? 4 : 0;
  const total = formatLocal(sale.amount, sale.currency);
  const fanName = sale.fan.username ? `@${sale.fan.username}` : (sale.fan.name ?? 'Fan');

  return (
    <div className="container max-w-lg space-y-4 py-6">
      <header className="space-y-1">
        <p className="text-xs text-muted-foreground">Pedido {sale.id.slice(-8).toUpperCase()} · {formatDateTime(sale.createdAt.toISOString())}</p>
        <h1 className="font-heading text-2xl uppercase tracking-wide">
          {formatTokens(sale.tokens)} tokens · {total}
        </h1>
        <p className="flex flex-wrap items-center gap-1.5 text-sm text-muted-foreground">
          {isFan ? (
            <>
              Vendedor: <strong className="text-foreground">{sale.distributor.legalName}</strong> <DistributorBadge compact />
            </>
          ) : (
            <>
              Comprador: <strong className="text-foreground">{fanName}</strong>
            </>
          )}
        </p>
      </header>

      {/* Pasos */}
      {sale.status !== 'CANCELLED' && (
        <ol className="grid grid-cols-4 gap-1 text-center text-[10px]">
          {STEPS.map((s, i) => (
            <li key={s} className="space-y-1">
              <span
                className={cn(
                  'mx-auto flex h-6 w-6 items-center justify-center rounded-full border text-[11px] font-bold',
                  i + 1 < step || step === 4
                    ? 'border-state-connected bg-state-connected text-black'
                    : i + 1 === step
                      ? 'border-primary text-primary'
                      : 'border-border text-muted-foreground',
                )}
              >
                {i + 1 < step || step === 4 ? <Check className="h-3.5 w-3.5" /> : i + 1}
              </span>
              <span className={i + 1 === step ? 'font-semibold' : 'text-muted-foreground'}>{s}</span>
            </li>
          ))}
        </ol>
      )}

      {/* Estado y acciones */}
      <section className="space-y-3 rounded-2xl border border-border/60 bg-card p-4">
        {sale.status === 'AWAITING_PAYMENT' && isFan && (
          <>
            <p className="text-sm">
              Paga <strong>{total}</strong> con <strong>{paymentMethodLabel(sale.account.method)}</strong> a estos datos:
            </p>
            <p className="select-all rounded-xl bg-muted/50 p-3 font-mono text-sm">{sale.account.details}</p>
            <p className="text-xs text-muted-foreground">
              Tus tokens están reservados. Tiempo para pagar y subir el comprobante:{' '}
              <Countdown until={sale.expiresAt.toISOString()} />
            </p>
            <FanPayForm saleId={sale.id} />
          </>
        )}
        {sale.status === 'AWAITING_PAYMENT' && isDist && (
          <>
            <p className="text-sm">
              {fanName} tiene que pagarte <strong>{total}</strong> por {paymentMethodLabel(sale.account.method)}. Los{' '}
              {formatTokens(sale.tokens)} tokens están reservados de tu stock.
            </p>
            <p className="text-xs text-muted-foreground">
              Caduca en <Countdown until={sale.expiresAt.toISOString()} /> si no paga.
            </p>
            <ReleaseButtons saleId={sale.id} canCancel />
          </>
        )}
        {sale.status === 'PAID' && isFan && (
          <>
            <p className="text-sm">
              Marcaste el pago como hecho (ref. <strong>{sale.paymentRef}</strong>). Esperando a que{' '}
              {sale.distributor.legalName} lo confirme y libere tus tokens.
            </p>
            <DisputeForm saleId={sale.id} label="Pagué y no me llegan los tokens" hint="Por ejemplo, el movimiento en tu banco o app de pago." />
          </>
        )}
        {sale.status === 'PAID' && isDist && (
          <>
            <p className="text-sm">
              {fanName} dice que pagó <strong>{total}</strong> (ref. <strong>{sale.paymentRef}</strong>). Mira su
              comprobante abajo y comprueba que el dinero está en tu cuenta antes de liberar.
            </p>
            <ReleaseButtons saleId={sale.id} canCancel={false} />
            <DisputeForm saleId={sale.id} label="No me llegó el pago" hint="Por ejemplo, tus movimientos del día sin ese pago." />
          </>
        )}
        {sale.status === 'DISPUTED' && (
          <>
            <p className="text-sm">
              <strong>En revisión por el equipo.</strong> Disputa abierta por {sale.disputeBy === 'FAN' ? 'el fan' : 'el distribuidor'}:{' '}
              «{sale.disputeReason}». Los tokens siguen reservados.
            </p>
            {isAdmin && <ResolveDispute saleId={sale.id} />}
          </>
        )}
        {sale.status === 'COMPLETED' && (
          <>
            <p className="flex items-center gap-2 text-sm font-semibold text-state-connected">
              <Check className="h-4 w-4" /> {isFan ? `Recibiste ${formatTokens(sale.tokens)} tokens.` : 'Venta completada.'}
            </p>
            {isFan && sale.rating == null && (
              <>
                <p className="text-xs text-muted-foreground">¿Qué tal con este distribuidor?</p>
                <RateSale saleId={sale.id} />
              </>
            )}
            {isFan && (
              <Link href="/wallet" className="block text-sm font-semibold text-primary">
                Ver mi monedero
              </Link>
            )}
          </>
        )}
        {sale.status === 'CANCELLED' && (
          <p className="text-sm text-muted-foreground">Pedido cancelado: {sale.cancelReason ?? '—'}. No se movió ningún token.</p>
        )}
        {sale.resolutionNote && (
          <p className="rounded-xl bg-muted/50 p-3 text-sm">
            <strong>Decisión del equipo:</strong> {sale.resolutionNote}
          </p>
        )}
      </section>

      {proofUrl && (
        <section className="space-y-2 rounded-2xl border border-border/60 bg-card p-4">
          <p className="text-sm font-semibold">Comprobante de pago del fan</p>
          <a href={proofUrl} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={proofUrl} alt="Comprobante de pago" className="max-h-80 w-full rounded-xl object-contain bg-muted/40" />
          </a>
          <p className="text-xs text-muted-foreground">Ref.: {sale.paymentRef}</p>
        </section>
      )}

      {evidenceUrl && (
        <section className="space-y-2 rounded-2xl border border-rose-500/40 bg-card p-4">
          <p className="text-sm font-semibold">Prueba de la disputa ({sale.disputeBy === 'FAN' ? 'del fan' : 'del distribuidor'})</p>
          <a href={evidenceUrl} target="_blank" rel="noreferrer" className="block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={evidenceUrl} alt="Prueba de la disputa" className="max-h-80 w-full rounded-xl bg-muted/40 object-contain" />
          </a>
        </section>
      )}

      {isFan && sale.status !== 'CANCELLED' && (
        <div className="flex items-center gap-2 text-sm">
          <MessageCircle className="h-4 w-4 text-muted-foreground" />
          <span className="flex-1 text-muted-foreground">¿Dudas? Escríbele.</span>
          <ContactDistributorButton distributorId={sale.distributor.id} isAuthenticated label="Chat" />
        </div>
      )}

      <p className="flex items-start gap-2 text-xs text-muted-foreground">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-state-connected" />
        Compra protegida: los tokens se reservan al crear el pedido y solo se entregan cuando el distribuidor confirma el
        pago. Si no se paga en 30 minutos, el pedido caduca solo. Si hay un problema, el equipo revisa la disputa con el
        comprobante. El pago va directo al distribuidor: Fantasy Live no recibe ni devuelve ese dinero.
      </p>
    </div>
  );
}
