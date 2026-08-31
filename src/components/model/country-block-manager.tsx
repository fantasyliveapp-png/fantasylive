'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Globe, Loader2, Search, ShieldBan, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { COUNTRIES, countryFlag, countryName } from '@/lib/countries';
import { updateBlockedCountriesAction } from '@/server/actions/model';
import { cn } from '@/lib/utils';

/** Quita acentos para que "espana" encuentre "Espana" y "Mexico"/"mexico". */
function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

export function CountryBlockManager({
  initialCountries,
}: {
  initialCountries: string[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selected, setSelected] = useState<string[]>(() =>
    [...initialCountries].sort(),
  );
  const [saved, setSaved] = useState<string[]>(() =>
    [...initialCountries].sort(),
  );
  const [query, setQuery] = useState('');

  const selectedSet = useMemo(() => new Set(selected), [selected]);

  const filtered = useMemo(() => {
    const q = normalize(query.trim());
    if (!q) return COUNTRIES;
    return COUNTRIES.filter(
      (c) => normalize(c.name).includes(q) || c.code.toLowerCase().includes(q),
    );
  }, [query]);

  const isDirty =
    selected.length !== saved.length ||
    selected.some((code, i) => code !== saved[i]);

  function toggle(code: string) {
    setSelected((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : [...prev, code].sort(),
    );
  }

  function save() {
    startTransition(async () => {
      const result = await updateBlockedCountriesAction({ countries: selected });
      if (result.ok) {
        setSaved(result.data?.countries ?? selected);
        setSelected(result.data?.countries ?? selected);
        toast.success(result.message ?? 'Bloqueo actualizado');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo guardar');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldBan className="h-5 w-5 text-primary" />
          Paises bloqueados
        </CardTitle>
        <CardDescription>
          Tu perfil, tu contenido y tus llamadas quedan ocultos para quien
          navegue desde los paises que elijas. No apareceras en su catalogo ni
          podran emparejarse contigo.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-5">
        {/* Seleccion actual */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label>
              Bloqueados ({selected.length})
            </Label>
            {selected.length > 0 && (
              <Button
                variant="ghost"
                size="sm"
                disabled={isPending}
                onClick={() => setSelected([])}
              >
                Quitar todos
              </Button>
            )}
          </div>

          {selected.length === 0 ? (
            <div className="flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              <Globe className="h-4 w-4 shrink-0" />
              Tu perfil se ve desde todo el mundo.
            </div>
          ) : (
            <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-muted/30 p-3">
              {selected.map((code) => (
                <button
                  key={code}
                  type="button"
                  disabled={isPending}
                  onClick={() => toggle(code)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-destructive/10 py-1 pl-2.5 pr-1.5 text-xs font-medium text-destructive transition-colors hover:bg-destructive/20 disabled:opacity-50"
                  aria-label={`Desbloquear ${countryName(code)}`}
                >
                  <span aria-hidden>{countryFlag(code)}</span>
                  {countryName(code)}
                  <X className="h-3 w-3" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buscador */}
        <div className="space-y-2">
          <Label htmlFor="country-search">Anadir pais</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              id="country-search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Busca por nombre o codigo (ES, US, MX...)"
              className="pl-9"
              disabled={isPending}
            />
          </div>
        </div>

        {/* Lista */}
        <div className="max-h-72 overflow-y-auto rounded-lg border border-border">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              Ningun pais coincide con &quot;{query}&quot;.
            </p>
          ) : (
            <ul className="divide-y divide-border">
              {filtered.map((country) => {
                const isBlocked = selectedSet.has(country.code);
                return (
                  <li key={country.code}>
                    <button
                      type="button"
                      disabled={isPending}
                      onClick={() => toggle(country.code)}
                      aria-pressed={isBlocked}
                      className={cn(
                        'flex w-full items-center gap-3 px-3 py-2 text-left text-sm transition-colors disabled:opacity-50',
                        isBlocked
                          ? 'bg-destructive/10 text-destructive'
                          : 'hover:bg-muted',
                      )}
                    >
                      <span aria-hidden className="text-base">
                        {countryFlag(country.code)}
                      </span>
                      <span className="flex-1 truncate">{country.name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {country.code}
                      </span>
                      <span
                        className={cn(
                          'w-20 shrink-0 text-right text-xs font-medium',
                          isBlocked ? 'text-destructive' : 'text-muted-foreground',
                        )}
                      >
                        {isBlocked ? 'Bloqueado' : 'Permitido'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="flex items-center gap-3">
          <Button variant="brand" onClick={save} disabled={!isDirty || isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Guardar cambios
          </Button>
          {isDirty && !isPending && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setSelected([...saved])}
            >
              Descartar
            </Button>
          )}
          {isDirty && (
            <span className="text-xs text-muted-foreground">
              Tienes cambios sin guardar.
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
