import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Crown, ExternalLink, Flag, MessageCircle } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { FeatureButtons } from '@/components/admin/admin-tools';
import { Empty, Panel, PersonLink, Pill } from '@/components/admin/admin-ui';
import { UserModerationButtons } from '@/components/admin/supervision-actions';
import { adminMediaUrl, getAdminChats, personOf } from '@/lib/admin-supervision';
import { auditLabel } from '@/lib/admin-overview';
import { requireAdmin } from '@/lib/auth/guards';
import {
  KYC_STATUS_LABELS,
  REPORT_REASON_LABELS,
  REPORT_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
} from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { tokensToPayoutCents } from '@/lib/tokens';
import { cn, formatDate, formatDateTime, formatMoney, formatTokens, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Ficha' };
export const dynamic = 'force-dynamic';

const personSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  modelProfile: { select: { stageName: true, avatarUrl: true } },
} as const;

/**
 * FICHA DE UNA PERSONA: todo lo suyo en un sitio (cuenta, dinero, contenido,
 * chats, denuncias y lo que el equipo ha hecho con ella) y las acciones.
 */
export default async function AdminUserPage({ params }: { params: Promise<{ id: string }> }) {
  const admin = await requireAdmin();
  const { id } = await params;

  const user = await prisma.user.findUnique({
    where: { id },
    select: {
      id: true,
      email: true,
      name: true,
      username: true,
      image: true,
      role: true,
      status: true,
      isVip: true,
      country: true,
      birthDate: true,
      createdAt: true,
      lastSeenAt: true,
      banReason: true,
      suspendedUntil: true,
      wallet: true,
      referredBy: { select: personSelect },
      recruitedBy: { select: { code: true, user: { select: personSelect } } },
      recruiterAccount: { select: { id: true, code: true } },
      modelProfile: {
        select: {
          id: true,
          stageName: true,
          slug: true,
          avatarUrl: true,
          kycStatus: true,
          founderNumber: true,
          featuredUntil: true,
          isOnline: true,
          postsCount: true,
          totalTokensEarned: true,
        },
      },
    },
  });
  if (!user) notFound();

  const mp = user.modelProfile;
  const [reportsAgainst, reportsMade, transactions, posts, chats, audit, followers] = await Promise.all([
    prisma.report.findMany({
      where: { reportedId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 20,
      select: {
        id: true,
        reason: true,
        status: true,
        details: true,
        context: true,
        createdAt: true,
        reporter: { select: personSelect },
      },
    }),
    prisma.report.count({ where: { reporterId: user.id } }),
    prisma.transaction.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      take: 15,
      select: { id: true, type: true, tokens: true, amountCents: true, description: true, createdAt: true },
    }),
    mp
      ? prisma.post.findMany({
          where: { modelId: mp.id, OR: [{ isPublished: true }, { removedAt: { not: null } }] },
          orderBy: { createdAt: 'desc' },
          take: 12,
          select: {
            id: true,
            body: true,
            removedAt: true,
            assets: { orderBy: { sortOrder: 'asc' }, take: 1, select: { storageKey: true, mimeType: true } },
          },
        })
      : Promise.resolve([]),
    getAdminChats({ userId: user.id, take: 8 }),
    prisma.auditLog.findMany({
      where: { entityId: { in: [user.id, ...(mp ? [mp.id] : [])] } },
      orderBy: { createdAt: 'desc' },
      take: 10,
      include: { actor: { select: { name: true, username: true } } },
    }),
    mp ? prisma.follow.count({ where: { modelId: mp.id } }) : Promise.resolve(0),
  ]);

  const postThumbs = await Promise.all(
    posts.map(async (p) => ({
      id: p.id,
      body: p.body,
      removed: Boolean(p.removedAt),
      url: p.assets[0] ? await adminMediaUrl(p.assets[0].storageKey) : null,
      isVideo: p.assets[0]?.mimeType.startsWith('video/') ?? false,
    })),
  );

  const displayName = mp?.stageName ?? user.name ?? user.username ?? user.email;
  const avatar = mp?.avatarUrl ?? user.image;
  const w = user.wallet;
  const age = user.birthDate
    ? Math.floor((Date.now() - user.birthDate.getTime()) / (365.25 * 24 * 3600 * 1000))
    : null;
  const openReports = reportsAgainst.filter((r) => ['OPEN', 'UNDER_REVIEW', 'ESCALATED'].includes(r.status)).length;

  return (
    <>
      <Link
        href="/admin/users"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Usuarios
      </Link>

      <AdminPageHeader
        title={displayName}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {user.username && <span>@{user.username} ·</span>}
            <span>{user.email}</span>
          </span>
        }
        actions={
          <>
            {mp && (
              <Link
                href={`/models/${mp.slug}`}
                target="_blank"
                className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-sm hover:bg-white/[0.04]"
              >
                <ExternalLink className="h-4 w-4" /> Perfil publico
              </Link>
            )}
            <UserModerationButtons userId={user.id} status={user.status} isSelf={user.id === admin.id} />
          </>
        }
      />

      {user.status !== 'ACTIVE' && (
        <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          {user.status === 'BANNED' ? 'Cuenta baneada' : user.status === 'SUSPENDED' ? 'Cuenta suspendida' : 'Cuenta pendiente'}
          {user.suspendedUntil && user.status === 'SUSPENDED' && ` hasta ${formatDateTime(user.suspendedUntil)}`}
          {user.banReason && `. Motivo: ${user.banReason}`}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        {/* Columna izquierda: quien es */}
        <div className="space-y-6">
          <Panel>
            <div className="flex flex-col items-center px-5 py-6 text-center">
              {avatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={avatar} alt="" className="h-20 w-20 rounded-full object-cover" />
              ) : (
                <span className="flex h-20 w-20 items-center justify-center rounded-full bg-muted text-2xl font-bold uppercase">
                  {displayName.slice(0, 1)}
                </span>
              )}
              <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                <Pill tone={user.role === 'ADMIN' ? 'brand' : mp ? 'gold' : 'neutral'}>
                  {user.role === 'ADMIN' ? 'Admin' : mp ? 'Creadora' : 'Fan'}
                </Pill>
                <Pill tone={user.status === 'ACTIVE' ? 'good' : 'bad'}>
                  {user.status === 'ACTIVE' ? 'Activa' : user.status === 'BANNED' ? 'Baneada' : 'Suspendida'}
                </Pill>
                {user.isVip && <Pill tone="gold">VIP</Pill>}
                {mp?.founderNumber && (
                  <Pill tone="gold">
                    <Crown className="h-3 w-3" /> Fundadora #{mp.founderNumber}
                  </Pill>
                )}
                {user.recruiterAccount && <Pill tone="brand">Reclutador</Pill>}
              </div>
            </div>
            <dl className="divide-y divide-white/[0.06] border-t border-white/[0.06] text-sm">
              <Row k="Alta" v={formatDate(user.createdAt)} />
              <Row k="Ultima vez" v={user.lastSeenAt ? relativeTime(user.lastSeenAt) : '—'} />
              <Row k="Pais" v={user.country ?? '—'} />
              <Row k="Edad" v={age !== null ? `${age} años` : '—'} />
              {mp && (
                <Row
                  k="Identidad"
                  v={
                    <Link href="/admin/kyc" className="hover:underline">
                      {KYC_STATUS_LABELS[mp.kycStatus]}
                    </Link>
                  }
                />
              )}
              {mp && <Row k="Seguidores" v={formatTokens(followers)} />}
              {mp && <Row k="Publicaciones" v={formatTokens(mp.postsCount)} />}
              <Row
                k="La invito"
                v={
                  user.referredBy ? (
                    <PersonLink {...personOf(user.referredBy)} size="sm" />
                  ) : user.recruitedBy ? (
                    <PersonLink {...personOf(user.recruitedBy.user)} size="sm" />
                  ) : (
                    '—'
                  )
                }
              />
            </dl>
          </Panel>

          {mp?.kycStatus === 'APPROVED' && (
            <Panel
              title="Destacar en Descubrir"
              aside={
                mp.featuredUntil && mp.featuredUntil > new Date()
                  ? `hasta ${formatDate(mp.featuredUntil)}`
                  : undefined
              }
            >
              <div className="px-5 py-4">
                <FeatureButtons
                  modelId={mp.id}
                  featured={Boolean(mp.featuredUntil && mp.featuredUntil > new Date())}
                />
              </div>
            </Panel>
          )}

          <Panel title="Dinero">
            <dl className="divide-y divide-white/[0.06] text-sm">
              <Row k="Saldo" v={`${formatTokens(w?.balance ?? 0)} tokens`} />
              <Row k="Comprado" v={`${formatTokens(w?.lifetimePurchased ?? 0)} tokens`} />
              <Row k="Gastado" v={`${formatTokens(w?.lifetimeSpent ?? 0)} tokens`} />
              {(mp || user.recruiterAccount) && (
                <>
                  <Row k="Ganado" v={formatMoney(tokensToPayoutCents(w?.lifetimeEarned ?? 0))} />
                  <Row k="Por retirar" v={formatMoney(tokensToPayoutCents(w?.pendingEarnings ?? 0))} />
                  <Row k="Retirado" v={formatMoney(tokensToPayoutCents(w?.lifetimeWithdrawn ?? 0))} />
                </>
              )}
            </dl>
          </Panel>
        </div>

        {/* Columna derecha: lo que ha hecho */}
        <div className="min-w-0 space-y-6">
          <Panel
            title="Denuncias contra esta cuenta"
            aside={
              <span className="flex items-center gap-2">
                {openReports > 0 && <Pill tone="warn">{openReports} abiertas</Pill>}
                <span>Ha denunciado a otros: {reportsMade}</span>
              </span>
            }
          >
            {reportsAgainst.length === 0 ? (
              <Empty>Nadie la ha denunciado.</Empty>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {reportsAgainst.map((r) => {
                  const by = personOf(r.reporter);
                  const target = contextLink(r.context);
                  return (
                    <li key={r.id} className="flex flex-wrap items-center gap-3 px-5 py-3 text-sm">
                      <Flag className="h-4 w-4 text-amber-500" />
                      <span className="font-medium">{REPORT_REASON_LABELS[r.reason]}</span>
                      <Pill tone={['OPEN', 'UNDER_REVIEW', 'ESCALATED'].includes(r.status) ? 'warn' : 'neutral'}>
                        {REPORT_STATUS_LABELS[r.status]}
                      </Pill>
                      {target && (
                        <Link href={target.href} className="text-xs text-primary hover:underline">
                          {target.label}
                        </Link>
                      )}
                      <span className="ml-auto flex items-center gap-2 text-[11px] text-muted-foreground">
                        por <PersonLink id={by.id} name={by.name} image={by.image} size="sm" /> ·{' '}
                        {relativeTime(r.createdAt)}
                      </span>
                      {r.details && <p className="w-full text-xs text-muted-foreground">{r.details}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          {mp && (
            <Panel
              title="Sus publicaciones"
              aside={
                <Link href={`/admin/content?q=${encodeURIComponent(user.username ?? mp.stageName)}`} className="text-primary hover:underline">
                  Ver todas
                </Link>
              }
            >
              {postThumbs.length === 0 ? (
                <Empty>Aun no ha publicado.</Empty>
              ) : (
                <ul className="grid grid-cols-3 gap-2 p-4 sm:grid-cols-4 xl:grid-cols-6">
                  {postThumbs.map((p) => (
                    <li key={p.id}>
                      <Link
                        href={`/admin/content/${p.id}`}
                        className="relative block aspect-square overflow-hidden rounded-lg bg-black"
                      >
                        {p.url ? (
                          p.isVideo ? (
                            <video src={`${p.url}#t=0.5`} muted preload="metadata" className="h-full w-full object-cover" />
                          ) : (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={p.url} alt="" className="h-full w-full object-cover" loading="lazy" />
                          )
                        ) : (
                          <p className="line-clamp-4 p-2 text-[10px] text-muted-foreground">{p.body}</p>
                        )}
                        {p.removed && (
                          <span className="absolute left-1 top-1 rounded bg-destructive px-1 text-[9px] font-bold uppercase text-white">
                            Retirada
                          </span>
                        )}
                      </Link>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          )}

          <Panel
            title="Sus chats"
            aside={
              user.username ? (
                <Link href={`/admin/chats?q=${encodeURIComponent(user.username)}`} className="text-primary hover:underline">
                  Ver todos
                </Link>
              ) : undefined
            }
          >
            {chats.length === 0 ? (
              <Empty>No tiene conversaciones.</Empty>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {chats.map((c) => {
                  const other = c.a.id === user.id ? c.b : c.a;
                  return (
                    <li key={`${c.kind}-${c.id}`}>
                      <Link
                        href={`/admin/chats/${c.kind}/${c.id}`}
                        className="flex items-center gap-3 px-5 py-2.5 text-sm hover:bg-white/[0.03]"
                      >
                        <MessageCircle className="h-4 w-4 text-muted-foreground" />
                        <span className="font-medium">con {other.name}</span>
                        {c.reports > 0 && <Pill tone="warn">{c.reports} denuncia(s)</Pill>}
                        <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">{c.lastBody}</span>
                        <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(c.lastMessageAt)}</span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>

          <div className="grid gap-6 xl:grid-cols-2">
            <Panel title="Ultimos movimientos">
              {transactions.length === 0 ? (
                <Empty>Sin movimientos.</Empty>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {transactions.map((t) => (
                    <li key={t.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{TRANSACTION_TYPE_LABELS[t.type]}</span>
                        <span className="block text-[11px] text-muted-foreground">{formatDateTime(t.createdAt)}</span>
                      </span>
                      <span
                        className={cn(
                          'shrink-0 font-semibold tabular-nums',
                          t.tokens > 0 ? 'text-state-connected' : 'text-muted-foreground',
                        )}
                      >
                        {t.tokens > 0 ? '+' : ''}
                        {formatTokens(t.tokens)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>

            <Panel title="Lo que el equipo hizo">
              {audit.length === 0 ? (
                <Empty>Sin acciones del equipo.</Empty>
              ) : (
                <ul className="divide-y divide-white/[0.06]">
                  {audit.map((a) => (
                    <li key={a.id} className="flex items-baseline gap-3 px-5 py-2.5">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm">{auditLabel(a.action)}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {a.actor?.name ?? a.actor?.username ?? 'Sistema'}
                        </span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{relativeTime(a.createdAt)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </div>
        </div>
      </div>
    </>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 px-5 py-2.5">
      <dt className="shrink-0 text-muted-foreground">{k}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{v}</dd>
    </div>
  );
}

/** A donde lleva lo denunciado ("post:<id>", "chat:<id>"...). */
function contextLink(context: string | null) {
  if (!context) return null;
  const [kind, id] = context.split(':');
  if (kind === 'post' && id) return { href: `/admin/content/${id}`, label: 'Ver publicacion' };
  if (kind === 'chat' && id) return { href: `/admin/chats/peer/${id}`, label: 'Ver chat' };
  if (kind === 'conversation' && id) return { href: `/admin/chats/fan/${id}`, label: 'Ver chat' };
  return null;
}
