import Link from 'next/link';
import {
  Coins,
  Eye,
  TrendingUp,
  UserPlus,
  Users,
} from 'lucide-react';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { CreatorAnalytics } from '@/lib/analytics';
import { countryFlag, countryName } from '@/lib/countries';
import { formatMoney, formatTokens, initials, relativeTime } from '@/lib/utils';

const RANGES = [7, 30, 90] as const;

/**
 * Panel de analiticas de una creadora.
 *
 * Todo se renderiza en servidor: son datos de negocio que no cambian cada
 * segundo y evitar el bundle de una libreria de graficos mantiene la pagina
 * ligera. El grafico de barras es CSS puro sobre los valores normalizados.
 */
export function AnalyticsPanel({
  analytics,
  payoutCentsPerToken,
}: {
  analytics: CreatorAnalytics;
  payoutCentsPerToken: number;
}) {
  const { totals, bySource, byDay, topBuyers, topVisitors, topCountries } =
    analytics;

  const maxDayTokens = Math.max(1, ...byDay.map((d) => d.tokens));
  const maxSourceTokens = Math.max(1, ...bySource.map((s) => s.tokens));

  return (
    <div className="space-y-6">
      {/* Selector de periodo */}
      <div className="flex gap-2">
        {RANGES.map((days) => (
          <Link key={days} href={`/dashboard/model/analytics?range=${days}`}>
            <Badge
              variant={analytics.rangeDays === days ? 'vip' : 'muted'}
              className="cursor-pointer px-3 py-1.5"
            >
              {days} dias
            </Badge>
          </Link>
        ))}
      </div>

      {/* Totales */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          icon={Coins}
          label="Tokens ganados"
          value={formatTokens(totals.tokensEarned)}
          hint={formatMoney(totals.tokensEarned * payoutCentsPerToken)}
        />
        <StatCard
          icon={Eye}
          label="Visitas"
          value={String(totals.visits)}
          hint={`${totals.uniqueVisitors} personas distintas`}
        />
        <StatCard
          icon={TrendingUp}
          label="Visitas que compran"
          value={`${totals.conversionPercent}%`}
          hint={`${totals.buyers} compradores`}
        />
        <StatCard
          icon={UserPlus}
          label="Nuevos seguidores"
          value={String(totals.newFollowers)}
          hint={`${totals.purchases} compras en total`}
        />
      </div>

      {/* Ingresos por dia */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Ingresos por dia (tokens)
          </CardTitle>
        </CardHeader>
        <CardContent>
          {totals.tokensEarned === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavia no hay datos en este periodo.
            </p>
          ) : (
            <div className="flex h-32 items-end gap-[2px]">
              {byDay.map((day) => (
                <div
                  key={day.day}
                  title={`${day.day}: ${day.tokens} tokens · ${day.visits} visitas`}
                  className="flex-1 rounded-t bg-primary/70 transition-colors hover:bg-primary"
                  style={{
                    // min 2px para que un dia con ingresos pequenos siga
                    // siendo visible y no parezca un dia sin actividad.
                    height: `${Math.max(2, (day.tokens / maxDayTokens) * 100)}%`,
                  }}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Origen de los ingresos */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ingresos por origen</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {bySource.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Todavia no hay datos en este periodo.
              </p>
            )}
            {bySource.map((source) => (
              <div key={source.type}>
                <div className="flex items-baseline justify-between text-sm">
                  <span>{source.label}</span>
                  <span className="font-semibold text-token">
                    {formatTokens(source.tokens)}
                  </span>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-token"
                    style={{
                      width: `${(source.tokens / maxSourceTokens) * 100}%`,
                    }}
                  />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Paises */}
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              De donde te visitan
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {topCountries.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Todavia no hay datos en este periodo.
              </p>
            )}
            {topCountries.map((row) => (
              <div
                key={row.country}
                className="flex items-center justify-between text-sm"
              >
                <span>
                  {countryFlag(row.country)} {countryName(row.country)}
                </span>
                <span className="text-muted-foreground">
                  {row.visits} visitas
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Mejores compradores */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Coins className="h-4 w-4 text-token" />
              Mejores compradores
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topBuyers.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Todavia no hay datos en este periodo.
              </p>
            )}
            {topBuyers.map((buyer, index) => (
              <div key={buyer.userId} className="flex items-center gap-3">
                <span className="w-5 text-center text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={buyer.image ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {initials(buyer.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{buyer.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {buyer.purchases} compras · {buyer.visits} visitas ·{' '}
                    {relativeTime(new Date(buyer.lastPurchaseAt))}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold text-token">
                  {formatTokens(buyer.tokens)}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Quien visita mas */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Users className="h-4 w-4 text-primary" />
              Quien te visita mas
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {topVisitors.length === 0 && (
              <p className="text-sm text-muted-foreground">
                Todavia no hay datos en este periodo.
              </p>
            )}
            {topVisitors.map((visitor, index) => (
              <div
                key={visitor.userId ?? `anon-${index}`}
                className="flex items-center gap-3"
              >
                <span className="w-5 text-center text-xs font-semibold text-muted-foreground">
                  {index + 1}
                </span>
                <Avatar className="h-8 w-8">
                  <AvatarImage src={visitor.image ?? undefined} />
                  <AvatarFallback className="text-[10px]">
                    {initials(visitor.name)}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{visitor.name}</p>
                  <p className="text-xs text-muted-foreground">
                    {visitor.tokensSpent > 0
                      ? `${formatTokens(visitor.tokensSpent)} gastados`
                      : 'Sin compras todavia'}
                    {visitor.country ? ` · ${visitor.country}` : ''}
                  </p>
                </div>
                <span className="shrink-0 text-sm font-semibold">
                  {visitor.visits}
                </span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  hint,
}: {
  icon: typeof Coins;
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card>
      <CardContent className="pt-6">
        <Icon className="h-4 w-4 text-muted-foreground" />
        <p className="mt-2 text-2xl font-bold">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
        {hint && <p className="mt-1 text-xs text-muted-foreground/70">{hint}</p>}
      </CardContent>
    </Card>
  );
}
