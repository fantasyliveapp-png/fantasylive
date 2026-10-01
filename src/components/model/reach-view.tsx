import Link from 'next/link';
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  CalendarClock,
  Clock,
  Eye,
  FlaskConical,
  Heart,
  Image as ImageIcon,
  Lock,
  MessageCircle,
  PlayCircle,
  Scale,
  TrendingDown,
  TrendingUp,
  Type,
  Users,
  type LucideIcon,
} from 'lucide-react';

import { BestTimeCard } from '@/components/model/best-time-card';
import type { CreatorReach, ReachPost } from '@/lib/creator-reach';
import { cn, formatMoney, relativeTime } from '@/lib/utils';

const fmt = (n: number) => n.toLocaleString('es');

/**
 * ALCANCE
 *
 * Para que la creadora vea que el reparto es justo y aprenda que funciona:
 * cuanta gente la ve, como va cada publicacion (en prueba o comparada con la
 * plataforma), cuanto tiempo la miran, lo que gano y a que hora publicar.
 */
export function ReachView({ reach }: { reach: CreatorReach }) {
  const { week } = reach;
  const change =
    week.prevViews > 0 ? Math.round(((week.views - week.prevViews) / week.prevViews) * 100) : null;

  return (
    <div className="space-y-5">
      <header>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Alcance</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Cuanta gente ve lo que publicas y que es lo que mejor funciona.
        </p>
      </header>

      {/* Esta semana */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat icon={Users} label="Personas alcanzadas" value={fmt(week.people)} hint="ultimos 7 dias" />
        <Stat
          icon={Eye}
          label="Vistas"
          value={fmt(week.views)}
          hint={
            change === null ? 'ultimos 7 dias' : `${change >= 0 ? '+' : ''}${change} % vs semana anterior`
          }
          trend={change === null ? undefined : change >= 0 ? 'up' : 'down'}
        />
        <Stat
          icon={Clock}
          label="Tiempo medio"
          value={week.avgWatchSec === null ? '—' : `${week.avgWatchSec} s`}
          hint="por publicacion vista"
        />
        <Stat
          icon={BarChart3}
          label="Publicaciones"
          value={fmt(reach.posts.filter((p) => p.status.kind !== 'scheduled').length)}
          hint="ultimas 30"
        />
      </section>

      {/* Como repartimos */}
      <section className="flex gap-3 rounded-2xl border border-primary/30 bg-primary/5 p-4 text-sm">
        <Scale className="h-5 w-5 shrink-0 text-primary" />
        <div className="space-y-1">
          <p className="font-semibold">Todos los creadores tienen la misma oportunidad</p>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Cada publicacion nueva se enseña a unas 40 personas aunque tengas pocos
            seguidores (fase de prueba). Despues, cuanto mas gusta (me gusta, comentarios,
            desbloqueos, tiempo que la miran), a mas gente llega. No depende de cuantos
            seguidores tengas.
          </p>
        </div>
      </section>

      <BestTimeCard activity={reach.activity} source={reach.activitySource} />

      {/* Publicaciones */}
      <section>
        <h2 className="mb-2.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          Tus publicaciones
        </h2>
        {reach.posts.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border/60 p-8 text-center text-sm text-muted-foreground">
            Aun no has publicado nada.{' '}
            <Link href="/dashboard/model/posts?nuevo=1" className="font-medium text-primary">
              Haz tu primera publicacion
            </Link>
          </div>
        ) : (
          <ul className="space-y-2">
            {reach.posts.map((post) => (
              <ReachRow key={post.id} post={post} />
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  hint,
  trend,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  hint: string;
  trend?: 'up' | 'down';
}) {
  return (
    <div className="rounded-2xl border border-border/60 bg-card p-3.5">
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        {label}
      </p>
      <p className="mt-1 font-heading text-2xl leading-none">{value}</p>
      <p
        className={cn(
          'mt-1 flex items-center gap-0.5 text-[11px]',
          trend === 'up'
            ? 'text-state-connected'
            : trend === 'down'
              ? 'text-amber-500'
              : 'text-muted-foreground',
        )}
      >
        {trend === 'up' && <ArrowUpRight className="h-3 w-3" />}
        {trend === 'down' && <ArrowDownRight className="h-3 w-3" />}
        {hint}
      </p>
    </div>
  );
}

const TYPE_ICONS: Record<ReachPost['type'], LucideIcon> = {
  image: ImageIcon,
  video: PlayCircle,
  text: Type,
  poll: BarChart3,
};

function ReachRow({ post }: { post: ReachPost }) {
  const TypeIcon = TYPE_ICONS[post.type];
  return (
    <li className="rounded-2xl border border-border/60 bg-card p-3">
      <div className="flex gap-3">
        <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-muted">
          {post.thumbUrl ? (
            /* eslint-disable-next-line @next/next/no-img-element */
            <img src={post.thumbUrl} alt="" className="h-full w-full object-cover" />
          ) : (
            <span className="flex h-full w-full items-center justify-center text-primary">
              <TypeIcon className="h-5 w-5" />
            </span>
          )}
          {post.visibility !== 'PUBLIC' && (
            <span className="absolute right-1 top-1 rounded-full bg-black/60 p-0.5">
              <Lock className="h-2.5 w-2.5 text-white" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <p className="line-clamp-1 text-sm font-medium">
              {post.body ?? (post.type === 'video' ? 'Video' : post.type === 'poll' ? 'Encuesta' : 'Foto')}
            </p>
            <span className="shrink-0 text-[11px] text-muted-foreground">
              {relativeTime(new Date(post.createdAt))}
            </span>
          </div>
          <StatusChip post={post} />
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            <Metric icon={Eye} value={fmt(post.views)} />
            <Metric icon={Heart} value={fmt(post.likes)} />
            <Metric icon={MessageCircle} value={fmt(post.comments)} />
            {post.unlocks > 0 && <Metric icon={Lock} value={fmt(post.unlocks)} />}
            {post.avgWatchSec !== null && <Metric icon={Clock} value={`${post.avgWatchSec} s`} />}
            {post.completionPct !== null && (
              <Metric icon={PlayCircle} value={`${post.completionPct} % completo`} />
            )}
            {post.earnedCents > 0 && (
              <span className="font-semibold text-state-connected">
                {formatMoney(post.earnedCents)}
              </span>
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

function Metric({ icon: Icon, value }: { icon: LucideIcon; value: string }) {
  return (
    <span className="flex items-center gap-1">
      <Icon className="h-3 w-3" />
      {value}
    </span>
  );
}

function StatusChip({ post }: { post: ReachPost }) {
  const s = post.status;
  if (s.kind === 'scheduled') {
    return (
      <p className="mt-1 flex items-center gap-1 text-xs font-medium text-primary">
        <CalendarClock className="h-3.5 w-3.5" /> Programada
      </p>
    );
  }
  if (s.kind === 'testing') {
    return (
      <div className="mt-1.5">
        <p className="flex items-center gap-1 text-xs font-medium text-primary">
          <FlaskConical className="h-3.5 w-3.5" /> En prueba · {s.views}/{s.target} personas
        </p>
        <div className="mt-1 h-1 w-full max-w-[180px] overflow-hidden rounded-full bg-muted">
          <div
            className="h-full rounded-full bg-primary"
            style={{ width: `${(s.views / s.target) * 100}%` }}
          />
        </div>
      </div>
    );
  }
  if (s.percentile === null) {
    return <p className="mt-1 text-xs text-muted-foreground">Llegando segun lo que gusta</p>;
  }
  const good = s.percentile >= 50;
  return (
    <p
      className={cn(
        'mt-1 flex items-center gap-1 text-xs font-medium',
        good ? 'text-state-connected' : 'text-amber-500',
      )}
    >
      {good ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}
      {good
        ? `Mejor que el ${s.percentile} % de las publicaciones`
        : s.percentile > 0
          ? `Por debajo de la media (mejor que el ${s.percentile} %)`
          : 'Por debajo de la media'}
    </p>
  );
}
