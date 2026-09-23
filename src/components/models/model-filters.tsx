'use client';

import { useCallback } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Search, X } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  GENDER_LABELS,
  PUBLIC_MODEL_TAGS,
  ORIENTATION_LABELS,
} from '@/lib/constants';

const SORT_OPTIONS = [
  { value: 'relevance', label: 'Relevancia' },
  { value: 'rating', label: 'Mejor valoradas' },
  { value: 'price_asc', label: 'Precio: menor a mayor' },
  { value: 'price_desc', label: 'Precio: mayor a menor' },
  { value: 'new', label: 'Nuevas' },
];

export function ModelFilters() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const setParam = useCallback(
    (key: string, value: string | null) => {
      const params = new URLSearchParams(searchParams.toString());
      if (value === null || value === '' || value === 'all') {
        params.delete(key);
      } else {
        params.set(key, value);
      }
      params.delete('page');
      router.push(`${pathname}?${params.toString()}`);
    },
    [pathname, router, searchParams],
  );

  const toggleMulti = useCallback(
    (key: string, value: string) => {
      const current = searchParams.get(key)?.split(',').filter(Boolean) ?? [];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      setParam(key, next.join(','));
    },
    [searchParams, setParam],
  );

  const activeGenders = searchParams.get('gender')?.split(',') ?? [];
  const activeOrientations = searchParams.get('orientation')?.split(',') ?? [];
  const activeTag = searchParams.get('tag');
  const onlineOnly = searchParams.get('online') === '1';
  const hasFilters = Array.from(searchParams.keys()).length > 0;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card/50 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="relative flex-1 min-w-[220px]"
          onSubmit={(e) => {
            e.preventDefault();
            const input = new FormData(e.currentTarget).get('q');
            setParam('q', String(input ?? ''));
          }}
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={searchParams.get('q') ?? ''}
            placeholder="Buscar por nombre o etiqueta..."
            className="pl-9"
          />
        </form>

        <Button
          variant={onlineOnly ? 'default' : 'outline'}
          size="sm"
          onClick={() => setParam('online', onlineOnly ? null : '1')}
        >
          <span className={onlineOnly ? 'live-dot !bg-white' : 'live-dot'} />
          Solo en vivo
        </Button>

        <Select
          value={searchParams.get('sort') ?? 'relevance'}
          onValueChange={(v) => setParam('sort', v === 'relevance' ? null : v)}
        >
          <SelectTrigger className="w-[200px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORT_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={() => router.push(pathname)}>
            <X className="h-4 w-4" />
            Limpiar
          </Button>
        )}
      </div>

      <div className="space-y-3">
        <FilterRow label="Genero">
          {Object.entries(GENDER_LABELS).map(([value, label]) => (
            <FilterChip
              key={value}
              active={activeGenders.includes(value)}
              onClick={() => toggleMulti('gender', value)}
            >
              {label}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Orientacion">
          {Object.entries(ORIENTATION_LABELS).map(([value, label]) => (
            <FilterChip
              key={value}
              active={activeOrientations.includes(value)}
              onClick={() => toggleMulti('orientation', value)}
            >
              {label}
            </FilterChip>
          ))}
        </FilterRow>

        <FilterRow label="Etiquetas">
          {PUBLIC_MODEL_TAGS.map((tag) => (
            <FilterChip
              key={tag}
              active={activeTag === tag}
              onClick={() => setParam('tag', activeTag === tag ? null : tag)}
            >
              {tag}
            </FilterChip>
          ))}
        </FilterRow>
      </div>
    </div>
  );
}

function FilterRow({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="w-24 shrink-0 text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <div className="flex flex-wrap gap-1.5">{children}</div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onClick}>
      <Badge
        variant={active ? 'default' : 'muted'}
        className="cursor-pointer capitalize hover:opacity-80"
      >
        {children}
      </Badge>
    </button>
  );
}
