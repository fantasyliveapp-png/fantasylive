import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, ExternalLink } from 'lucide-react';

import { AdminPageHeader } from '@/components/admin/admin-shell';
import { Empty, Panel, PersonLink, Pill } from '@/components/admin/admin-ui';
import { DeleteCommentButton, RemovePostButton } from '@/components/admin/supervision-actions';
import { adminMediaUrl, personOf } from '@/lib/admin-supervision';
import { requireAdmin } from '@/lib/auth/guards';
import { REPORT_REASON_LABELS } from '@/lib/constants';
import { prisma } from '@/lib/prisma';
import { tokensToPayoutCents } from '@/lib/tokens';
import { formatDateTime, formatMoney, formatTokens, relativeTime } from '@/lib/utils';

export const metadata: Metadata = { title: 'Publicacion' };
export const dynamic = 'force-dynamic';

const personSelect = {
  id: true,
  name: true,
  username: true,
  image: true,
  modelProfile: { select: { stageName: true, avatarUrl: true } },
} as const;

export default async function AdminPostPage({ params }: { params: Promise<{ postId: string }> }) {
  await requireAdmin();
  const { postId } = await params;

  const post = await prisma.post.findUnique({
    where: { id: postId },
    select: {
      id: true,
      body: true,
      visibility: true,
      priceTokens: true,
      isPublished: true,
      createdAt: true,
      removedAt: true,
      removedReason: true,
      viewCount: true,
      likeCount: true,
      commentCount: true,
      unlockCount: true,
      tokensEarned: true,
      assets: {
        orderBy: { sortOrder: 'asc' },
        select: { id: true, storageKey: true, mimeType: true },
      },
      poll: { select: { question: true, options: { orderBy: { sortOrder: 'asc' }, select: { id: true, text: true, voteCount: true } } } },
      model: { select: { slug: true, user: { select: personSelect } } },
      comments: {
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, body: true, createdAt: true, user: { select: personSelect } },
      },
    },
  });
  if (!post) notFound();

  const [assets, reports] = await Promise.all([
    Promise.all(
      post.assets.map(async (a) => ({
        id: a.id,
        url: await adminMediaUrl(a.storageKey),
        isVideo: a.mimeType.startsWith('video/'),
      })),
    ),
    prisma.report.findMany({
      where: { context: `post:${post.id}` },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        reason: true,
        details: true,
        status: true,
        createdAt: true,
        reporter: { select: personSelect },
      },
    }),
  ]);

  const creator = personOf(post.model.user);
  const status = post.removedAt
    ? { tone: 'bad' as const, label: 'Retirada' }
    : !post.isPublished
      ? { tone: 'neutral' as const, label: 'Borrador' }
      : post.createdAt > new Date()
        ? { tone: 'warn' as const, label: 'Programada' }
        : { tone: 'good' as const, label: 'Publicada' };

  return (
    <>
      <Link
        href="/admin/content"
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Contenido
      </Link>
      <AdminPageHeader
        title={`Publicacion de ${creator.name}`}
        description={`${formatDateTime(post.createdAt)} · ${
          post.visibility === 'PUBLIC'
            ? 'Gratis'
            : post.visibility === 'LOCKED'
              ? `De pago (${post.priceTokens} tokens)`
              : 'Solo suscriptores'
        }`}
        actions={
          <>
            <Link
              href={`/models/${post.model.slug}`}
              target="_blank"
              className="inline-flex h-9 items-center gap-1.5 rounded-md border border-white/[0.08] px-3 text-sm hover:bg-white/[0.04]"
            >
              <ExternalLink className="h-4 w-4" /> Perfil
            </Link>
            <RemovePostButton postId={post.id} removed={Boolean(post.removedAt)} />
          </>
        }
      />

      {post.removedAt && (
        <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm">
          Retirada {relativeTime(post.removedAt)}. Motivo: {post.removedReason}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
        <div className="min-w-0 space-y-6">
          <Panel title="Lo que se publico" aside={<Pill tone={status.tone}>{status.label}</Pill>}>
            <div className="space-y-4 p-5">
              {post.body && <p className="whitespace-pre-wrap text-sm">{post.body}</p>}
              {post.poll && (
                <div className="rounded-lg border border-white/[0.06] p-3 text-sm">
                  <p className="font-medium">{post.poll.question}</p>
                  <ul className="mt-2 space-y-1 text-muted-foreground">
                    {post.poll.options.map((o) => (
                      <li key={o.id}>
                        {o.text} · {o.voteCount} votos
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {assets.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {assets.map((a) =>
                    !a.url ? (
                      <div key={a.id} className="rounded-lg bg-black p-8 text-center text-xs text-muted-foreground">
                        Archivo no disponible
                      </div>
                    ) : a.isVideo ? (
                      <video key={a.id} src={a.url} controls playsInline className="w-full rounded-lg bg-black" />
                    ) : (
                      <a key={a.id} href={a.url} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={a.url} alt="" className="w-full rounded-lg bg-black object-contain" />
                      </a>
                    ),
                  )}
                </div>
              )}
            </div>
          </Panel>

          <Panel title="Comentarios" aside={`${post.comments.length}`}>
            {post.comments.length === 0 ? (
              <Empty>Sin comentarios.</Empty>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {post.comments.map((c) => {
                  const u = personOf(c.user);
                  return (
                    <li key={c.id} className="flex items-start gap-3 px-5 py-3">
                      <div className="w-36 shrink-0">
                        <PersonLink id={u.id} name={u.name} image={u.image} size="sm" />
                      </div>
                      <p className="min-w-0 flex-1 whitespace-pre-wrap break-words text-sm">{c.body}</p>
                      <span className="shrink-0 text-[11px] text-muted-foreground">
                        {relativeTime(c.createdAt)}
                      </span>
                      <DeleteCommentButton commentId={c.id} />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>

        <div className="space-y-6">
          <Panel title="Creadora">
            <div className="px-5 py-4">
              <PersonLink id={creator.id} name={creator.name} username={creator.username} image={creator.image} />
            </div>
          </Panel>

          <Panel title="Numeros">
            <dl className="divide-y divide-white/[0.06] text-sm">
              {[
                ['Vistas', formatTokens(post.viewCount)],
                ['Me gusta', formatTokens(post.likeCount)],
                ['Comentarios', formatTokens(post.commentCount)],
                ['Desbloqueos', formatTokens(post.unlockCount)],
                ['Ganado', formatMoney(tokensToPayoutCents(post.tokensEarned))],
              ].map(([k, v]) => (
                <div key={k} className="flex justify-between px-5 py-2.5">
                  <dt className="text-muted-foreground">{k}</dt>
                  <dd className="font-semibold tabular-nums">{v}</dd>
                </div>
              ))}
            </dl>
          </Panel>

          <Panel title="Denuncias" aside={`${reports.length}`}>
            {reports.length === 0 ? (
              <Empty>Nadie la ha denunciado.</Empty>
            ) : (
              <ul className="divide-y divide-white/[0.06]">
                {reports.map((r) => {
                  const u = personOf(r.reporter);
                  return (
                    <li key={r.id} className="space-y-1 px-5 py-3 text-sm">
                      <div className="flex items-center justify-between gap-2">
                        <Pill tone={r.status === 'RESOLVED' || r.status === 'DISMISSED' ? 'neutral' : 'warn'}>
                          {REPORT_REASON_LABELS[r.reason] ?? r.reason}
                        </Pill>
                        <span className="text-[11px] text-muted-foreground">{relativeTime(r.createdAt)}</span>
                      </div>
                      {r.details && <p className="text-xs text-muted-foreground">{r.details}</p>}
                      <PersonLink id={u.id} name={u.name} image={u.image} size="sm" />
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        </div>
      </div>
    </>
  );
}
