'use client';

import { useActionState, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  AtSign,
  Camera,
  Check,
  Heart,
  Dices,
  Eye,
  EyeOff,
  BadgeCheck,
  Loader2,
  Lock,
  ShieldAlert,
  VenetianMask,
  X,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { GENDER_LABELS } from '@/lib/constants';
import { USERNAME_PATTERN } from '@/lib/usernames';
import { cn } from '@/lib/utils';
import {
  checkUsernameAction,
  registerAction,
  type ActionState,
} from '@/server/actions/auth';

const initialState: ActionState = {};
const MIN_AGE = Number(process.env.NEXT_PUBLIC_MIN_AGE ?? 18) || 18;

const MONTHS = [
  'Enero',
  'Febrero',
  'Marzo',
  'Abril',
  'Mayo',
  'Junio',
  'Julio',
  'Agosto',
  'Septiembre',
  'Octubre',
  'Noviembre',
  'Diciembre',
];

// Para el boton de alias al azar.
const ALIAS_A = [
  'lobo',
  'luna',
  'noche',
  'fuego',
  'gato',
  'sombra',
  'zorro',
  'brisa',
  'rayo',
  'eco',
];
const ALIAS_B = [
  'secreto',
  'nocturno',
  'salvaje',
  'dorado',
  'curioso',
  'tranquilo',
  'rebelde',
  'oculto',
];

function randomAlias() {
  const pick = <T,>(list: T[]) =>
    list[Math.floor(Math.random() * list.length)]!;
  return `${pick(ALIAS_A)}.${pick(ALIAS_B)}${Math.floor(Math.random() * 90 + 10)}`;
}

function ageFrom(year: number, month: number, day: number) {
  const today = new Date();
  let age = today.getFullYear() - year;
  if (
    today.getMonth() + 1 < month ||
    (today.getMonth() + 1 === month && today.getDate() < day)
  ) {
    age -= 1;
  }
  return age;
}

type UsernameStatus = 'idle' | 'checking' | 'free' | 'taken';

/**
 * REGISTRO ANONIMO Y SOLO PARA MAYORES DE EDAD.
 *
 * Deja claro desde el principio las dos cosas que importan: puedes estar sin
 * que nadie sepa quien eres (solo se ve un @alias; el email y la fecha de
 * nacimiento son privados), y es obligatorio ser mayor de edad (si la fecha
 * no llega a 18 se avisa al momento y no se puede continuar).
 */
export function RegisterForm({
  defaultRole,
  next = null,
}: {
  defaultRole: 'USER' | 'MODEL';
  /** A donde volver tras la bienvenida (la pagina donde quiso hacer algo). */
  next?: string | null;
}) {
  const router = useRouter();
  // Una sola cuenta para todos. Quien elige "crear" sale de aqui ya como
  // creadora (sin segundo formulario) y aterriza en su panel.
  const [wantsCreator, setWantsCreator] = useState(defaultRole === 'MODEL');
  const [gender, setGender] = useState('');
  const [state, formAction, isPending] = useActionState(
    registerAction,
    initialState,
  );

  const [username, setUsername] = useState('');
  const [usernameStatus, setUsernameStatus] = useState<UsernameStatus>('idle');
  const [usernameHint, setUsernameHint] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [password, setPassword] = useState('');
  // Controlados: si el servidor devuelve un error, el formulario no se vacia.
  const [email, setEmail] = useState('');
  const [day, setDay] = useState('');
  const [month, setMonth] = useState('');
  const [year, setYear] = useState('');
  const checkSeq = useRef(0);

  useEffect(() => {
    if (state.success) {
      toast.success(state.success);
      // A los fans se les pregunta que les gusta para su Descubrir.
      router.push(
        wantsCreator
          ? '/dashboard/model'
          : `/bienvenida${next ? `?next=${encodeURIComponent(next)}` : ''}`,
      );
      router.refresh();
    }
    if (state.error) toast.error(state.error);
  }, [state, wantsCreator, router, next]);

  // Disponibilidad del @usuario mientras se escribe (con una pausa corta).
  useEffect(() => {
    const value = username.trim().toLowerCase();
    if (!value) {
      setUsernameStatus('idle');
      setUsernameHint(null);
      return;
    }
    if (value.length < 3 || !USERNAME_PATTERN.test(value)) {
      setUsernameStatus('taken');
      setUsernameHint(
        value.length < 3
          ? 'Minimo 3 caracteres'
          : 'Solo letras, numeros, punto, guion y guion bajo (sin empezar ni acabar en simbolo)',
      );
      return;
    }
    setUsernameStatus('checking');
    const seq = ++checkSeq.current;
    const timer = window.setTimeout(async () => {
      const result = await checkUsernameAction(value);
      if (seq !== checkSeq.current) return;
      setUsernameStatus(result.available ? 'free' : 'taken');
      setUsernameHint(
        result.available ? null : (result.error ?? 'No disponible'),
      );
    }, 400);
    return () => window.clearTimeout(timer);
  }, [username]);

  const years = useMemo(() => {
    const now = new Date().getFullYear();
    // Se listan tambien anos de menores: asi quien lo es ve el aviso claro
    // en vez de no encontrar su ano.
    return Array.from({ length: 90 }, (_, i) => now - 10 - i);
  }, []);

  const daysInMonth = month
    ? new Date(Number(year || 2000), Number(month), 0).getDate()
    : 31;

  // 31 de febrero no existe: al cambiar mes o ano se ajusta el dia.
  useEffect(() => {
    if (day && Number(day) > daysInMonth) setDay(String(daysInMonth));
  }, [day, daysInMonth]);
  const birthComplete =
    Boolean(day && month && year) && Number(day) <= daysInMonth;
  const age = birthComplete
    ? ageFrom(Number(year), Number(month), Number(day))
    : null;
  const isMinor = age !== null && age < MIN_AGE;
  const birthDate = birthComplete
    ? `${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
    : '';

  const passwordOk =
    password.length >= 8 && /[A-Za-z]/.test(password) && /[0-9]/.test(password);
  const fieldError = (name: string) => state.fieldErrors?.[name]?.[0];

  return (
    <Card className="gap-0 overflow-hidden py-0">
      <CardContent className="p-0">
        {/* Cabecera: lo importante antes de rellenar nada */}
        <div className="relative overflow-hidden border-b border-border/60 bg-gradient-to-br from-primary/15 via-card to-card px-6 pb-5 pt-6">
          <div
            aria-hidden
            className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-primary/25 blur-3xl"
          />
          <h1 className="relative font-heading text-3xl uppercase tracking-wide">
            Crea tu cuenta
          </h1>
          <p className="relative mt-1 text-sm text-muted-foreground">
            Sin tu nombre real. Solo un alias.
          </p>

          <div className="relative mt-4 grid grid-cols-3 gap-2 text-center">
            <Pill
              icon={VenetianMask}
              title="Anonimato"
              text="Nadie sabe quien eres"
            />
            <Pill
              icon={ShieldAlert}
              title="Solo +18"
              text="Obligatorio"
              tone="danger"
            />
            <Pill icon={BadgeCheck} title="Gratis" text="Crear cuenta no cuesta nada" />
          </div>
        </div>

        <form action={formAction} className="flex flex-col gap-5 px-6 py-6">
          {/* Que viene a hacer: una sola cuenta, pero asi no hay segundo registro */}
          <fieldset className="space-y-2">
            <legend className="mb-2 text-sm font-medium">¿Que quieres hacer?</legend>
            <input type="hidden" name="role" value={wantsCreator ? 'MODEL' : 'USER'} />
            <div className="grid grid-cols-2 gap-2">
              <RoleCard
                icon={Heart}
                title="Ver y conocer"
                text="Sigue a creadoras y habla con ellas"
                active={!wantsCreator}
                onClick={() => setWantsCreator(false)}
              />
              <RoleCard
                icon={Camera}
                title="Crear y ganar"
                text="Sube contenido y cobra por ello"
                active={wantsCreator}
                onClick={() => setWantsCreator(true)}
              />
            </div>
            {wantsCreator && (
              <div className="space-y-2 pt-2">
                <p className="text-sm font-medium">Te presentas como</p>
                <input type="hidden" name="gender" value={gender} />
                <div className="flex flex-wrap gap-2">
                  {Object.entries(GENDER_LABELS).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setGender(value)}
                      className={cn(
                        'rounded-full border px-3 py-1.5 text-sm transition-colors',
                        gender === value
                          ? 'border-primary bg-primary/15 text-foreground'
                          : 'border-border/60 text-muted-foreground hover:text-foreground',
                      )}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <p
                  className={cn(
                    'text-xs',
                    fieldError('gender') ? 'text-destructive' : 'text-muted-foreground',
                  )}
                >
                  {fieldError('gender') ??
                    'Tu perfil queda listo al crear la cuenta. Podras usar la app como fan tambien.'}
                </p>
              </div>
            )}
          </fieldset>

          {/* @usuario */}
          <div className="space-y-1.5">
            <Label htmlFor="username">Tu @usuario</Label>
            <div className="relative">
              <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="username"
                name="username"
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={30}
                value={username}
                onChange={(e) =>
                  setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))
                }
                placeholder="tu.alias"
                className="pl-9 pr-20"
                aria-invalid={
                  usernameStatus === 'taken' || Boolean(fieldError('username'))
                }
              />
              <span className="absolute right-2 top-1/2 flex -translate-y-1/2 items-center gap-1">
                {usernameStatus === 'checking' && (
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                )}
                {usernameStatus === 'free' && (
                  <Check className="h-4 w-4 text-state-connected" />
                )}
                {usernameStatus === 'taken' && (
                  <X className="h-4 w-4 text-destructive" />
                )}
                <button
                  type="button"
                  onClick={() => setUsername(randomAlias())}
                  className="rounded-md p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  aria-label="Inventar un alias"
                  title="Inventar un alias"
                >
                  <Dices className="h-4 w-4" />
                </button>
              </span>
            </div>
            <p
              className={cn(
                'text-xs',
                usernameStatus === 'taken' || fieldError('username')
                  ? 'text-destructive'
                  : usernameStatus === 'free'
                    ? 'text-state-connected'
                    : 'text-muted-foreground',
              )}
            >
              {fieldError('username') ??
                usernameHint ??
                (usernameStatus === 'free'
                  ? 'Disponible'
                  : 'Es lo unico que veran los demas. Usa un alias si no quieres que te reconozcan.')}
            </p>
          </div>

          {/* Email */}
          <div className="space-y-1.5">
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="tu@email.com"
            />
            <p
              className={cn(
                'flex items-center gap-1 text-xs',
                fieldError('email')
                  ? 'text-destructive'
                  : 'text-muted-foreground',
              )}
            >
              {fieldError('email') ?? (
                <>
                  <Lock className="h-3 w-3" /> Privado: nadie lo ve. Solo sirve
                  para entrar y recuperar tu cuenta.
                </>
              )}
            </p>
          </div>

          {/* Contrasena */}
          <div className="space-y-1.5">
            <Label htmlFor="password">Contraseña</Label>
            <div className="relative">
              <Input
                id="password"
                name="password"
                type={showPassword ? 'text' : 'password'}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Minimo 8, con letras y numeros"
                className="pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-muted-foreground hover:text-foreground"
                aria-label={
                  showPassword ? 'Ocultar contraseña' : 'Ver contraseña'
                }
              >
                {showPassword ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
            <p
              className={cn(
                'text-xs',
                fieldError('password')
                  ? 'text-destructive'
                  : passwordOk
                    ? 'text-state-connected'
                    : 'text-muted-foreground',
              )}
            >
              {fieldError('password') ??
                (passwordOk
                  ? 'Contraseña segura'
                  : 'Minimo 8 caracteres, con letras y numeros')}
            </p>
          </div>

          {/* Fecha de nacimiento */}
          <fieldset className="space-y-1.5">
            <legend className="mb-1.5 text-sm font-medium">
              Fecha de nacimiento
            </legend>
            <div className="grid grid-cols-[1fr_1.6fr_1.2fr] gap-2">
              <DateSelect label="Dia" value={day} onChange={setDay}>
                {Array.from({ length: daysInMonth }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>
                    {i + 1}
                  </option>
                ))}
              </DateSelect>
              <DateSelect label="Mes" value={month} onChange={setMonth}>
                {MONTHS.map((m, i) => (
                  <option key={m} value={String(i + 1)}>
                    {m}
                  </option>
                ))}
              </DateSelect>
              <DateSelect label="Año" value={year} onChange={setYear}>
                {years.map((y) => (
                  <option key={y} value={String(y)}>
                    {y}
                  </option>
                ))}
              </DateSelect>
            </div>
            <input type="hidden" name="birthDate" value={birthDate} />

            {isMinor ? (
              <div
                role="alert"
                className="mt-2 flex gap-2.5 rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm"
              >
                <ShieldAlert className="h-5 w-5 shrink-0 text-destructive" />
                <span>
                  <strong className="block">
                    Tienes que ser mayor de edad
                  </strong>
                  <span className="text-xs text-muted-foreground">
                    FantasyLive es solo para personas de {MIN_AGE} años o mas.
                    No puedes crear una cuenta ni ver contenido.
                  </span>
                </span>
              </div>
            ) : (
              <p
                className={cn(
                  'flex items-center gap-1 text-xs',
                  fieldError('birthDate')
                    ? 'text-destructive'
                    : 'text-muted-foreground',
                )}
              >
                {fieldError('birthDate') ?? (
                  <>
                    <Lock className="h-3 w-3" /> No se muestra en tu perfil.
                    Solo comprobamos que eres mayor de edad.
                  </>
                )}
              </p>
            )}
          </fieldset>

          {/* Confirmaciones */}
          <div className="space-y-2.5 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="isAdult"
                required
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-[hsl(var(--primary))]"
              />
              <span>
                <strong>Tengo {MIN_AGE} años o mas.</strong>{' '}
                <span className="text-muted-foreground">
                  Entiendo que aqui hay contenido para adultos y que pueden
                  pedirme verificar mi edad.
                </span>
              </span>
            </label>
            <label className="flex items-start gap-2.5 text-sm">
              <input
                type="checkbox"
                name="acceptTerms"
                required
                className="mt-0.5 h-4 w-4 shrink-0 rounded border-border accent-[hsl(var(--primary))]"
              />
              <span className="text-muted-foreground">
                Acepto los{' '}
                <Link
                  href="/legal/terms"
                  className="text-foreground underline"
                  target="_blank"
                >
                  terminos
                </Link>{' '}
                y la{' '}
                <Link
                  href="/legal/privacy"
                  className="text-foreground underline"
                  target="_blank"
                >
                  politica de privacidad
                </Link>
                .
              </span>
            </label>
            {(fieldError('isAdult') || fieldError('acceptTerms')) && (
              <p className="text-xs text-destructive">
                {fieldError('isAdult') ?? fieldError('acceptTerms')}
              </p>
            )}
          </div>

          <Button
            type="submit"
            variant="brand"
            size="lg"
            className="h-12 w-full"
            disabled={
              isPending || isMinor || usernameStatus === 'taken' || (wantsCreator && !gender)
            }
          >
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            {wantsCreator ? 'Crear mi cuenta de creadora' : 'Crear cuenta'}
          </Button>
          {wantsCreator && (
            <p className="-mt-2 text-center text-xs text-muted-foreground">
              Para cobrar verificaras tu identidad despues, desde tu panel. Tus fans solo
              veran tu alias.
            </p>
          )}

          <p className="text-center text-sm text-muted-foreground">
            ¿Ya tienes cuenta?{' '}
            <Link
              href="/login"
              className="font-medium text-primary hover:underline"
            >
              Inicia sesion
            </Link>
          </p>
        </form>
      </CardContent>
    </Card>
  );
}

function RoleCard({
  icon: Icon,
  title,
  text,
  active,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'flex flex-col items-start rounded-xl border p-3 text-left transition-colors',
        active
          ? 'border-primary bg-primary/10 ring-1 ring-primary'
          : 'border-border/60 hover:border-border',
      )}
    >
      <Icon className={cn('h-5 w-5', active ? 'text-primary' : 'text-muted-foreground')} />
      <span className="mt-2 text-sm font-semibold">{title}</span>
      <span className="text-xs leading-tight text-muted-foreground">{text}</span>
    </button>
  );
}

function Pill({
  icon: Icon,
  title,
  text,
  tone,
}: {
  icon: LucideIcon;
  title: string;
  text: string;
  tone?: 'danger';
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border px-2 py-2.5',
        tone === 'danger'
          ? 'border-destructive/40 bg-destructive/10'
          : 'border-border/60 bg-background/60',
      )}
    >
      <Icon
        className={cn(
          'h-5 w-5',
          tone === 'danger' ? 'text-destructive' : 'text-primary',
        )}
      />
      <span className="mt-1.5 block text-xs font-semibold">{title}</span>
      <span className="block text-[10px] leading-tight text-muted-foreground">
        {text}
      </span>
    </div>
  );
}

function DateSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  children: React.ReactNode;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      required
      className={cn(
        'h-10 w-full rounded-md border border-input bg-background px-2.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary',
        !value && 'text-muted-foreground',
      )}
    >
      <option value="" disabled>
        {label}
      </option>
      {children}
    </select>
  );
}
