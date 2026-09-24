'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Camera,
  Check,
  Cherry,
  Drama,
  Dumbbell,
  Flame,
  Flower2,
  Gamepad2,
  Gem,
  HeartHandshake,
  Landmark,
  Loader2,
  MessageCircle,
  Moon,
  Music,
  PenTool,
  Radio,
  Sparkles,
  Sun,
  UserPlus,
  Users,
  Video,
  WandSparkles,
  type LucideIcon,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import type { SuggestedCreator } from '@/lib/recommend';
import { GENDER_CHOICES, LOOKING_FOR_CHOICES, TASTE_TAGS, type Tastes } from '@/lib/tastes';
import { cn, initials } from '@/lib/utils';
import { toggleFollowAction } from '@/server/actions/follows';
import { saveTastesAction, skipTastesAction } from '@/server/actions/tastes';

type Step = 'who' | 'likes' | 'looking' | 'follow';

type IconComponent = LucideIcon | ((props: { className?: string }) => React.ReactElement);

// Simbolos de genero (lucide no los trae): mismo trazo que el resto de iconos.
function SvgIcon({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {children}
    </svg>
  );
}
const VenusIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <circle cx="12" cy="9" r="6" />
    <path d="M12 15v7M9 19h6" />
  </SvgIcon>
);
const MarsIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <circle cx="10" cy="14" r="6" />
    <path d="M14.5 9.5 21 3M16 3h5v5" />
  </SvgIcon>
);
const TransIcon = ({ className }: { className?: string }) => (
  <SvgIcon className={className}>
    <circle cx="12" cy="12" r="4.5" />
    <path d="M15.2 8.8 20 4M16.5 4H20v3.5M12 16.5V22M9.5 19.5h5M8.8 8.8 4 4M4 7.5V4h3.5M5 6l2-2" />
  </SvgIcon>
);

const GENDER_ICONS: Record<string, IconComponent> = {
  women: VenusIcon,
  men: MarsIcon,
  trans: TransIcon,
  couples: HeartHandshake,
};

const TAG_ICONS: Record<string, LucideIcon> = {
  latina: Music,
  europea: Landmark,
  asiatica: Flower2,
  fitness: Dumbbell,
  tatuajes: PenTool,
  piercing: Gem,
  rubia: Sun,
  morena: Moon,
  pelirroja: Flame,
  curvy: Cherry,
  roleplay: Drama,
  gamer: Gamepad2,
  cosplay: WandSparkles,
  pareja: Users,
};

const LOOKING_ICONS: Record<string, LucideIcon> = {
  fotos: Camera,
  directos: Radio,
  chatear: MessageCircle,
  videollamadas: Video,
};
const QUESTION_STEPS: Step[] = ['who', 'likes', 'looking'];

/**
 * BIENVENIDA: tres preguntas rapidas (a quien quieres ver, que te gusta, que
 * buscas) y un ultimo paso con creadoras para seguir. Con las respuestas se
 * ordena su Descubrir. Todo se puede saltar y cambiar luego en "Tus gustos".
 */
export function TastesWizard({
  initial,
  name,
  isEditing,
  returnTo = null,
}: {
  /** Pagina a la que volver al terminar (donde quiso hacer algo). */
  returnTo?: string | null;
  initial: Tastes;
  name: string | null;
  isEditing: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>('who');
  const [groups, setGroups] = useState<string[]>(() =>
    GENDER_CHOICES.filter((g) => g.genders.some((x) => initial.preferredGenders.includes(x))).map(
      (g) => g.id,
    ),
  );
  const [interests, setInterests] = useState<string[]>(initial.interests);
  const [lookingFor, setLookingFor] = useState<string[]>(initial.lookingFor);
  const [suggestions, setSuggestions] = useState<SuggestedCreator[]>([]);
  const [followed, setFollowed] = useState<Set<string>>(new Set());
  const [isPending, startTransition] = useTransition();

  const stepIndex = step === 'follow' ? 3 : QUESTION_STEPS.indexOf(step);
  const finish = () => {
    router.push(returnTo ?? '/feed');
    router.refresh();
  };

  function toggle(list: string[], set: (v: string[]) => void, id: string) {
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  }

  function skipAll() {
    startTransition(async () => {
      if (!isEditing) await skipTastesAction();
      finish();
    });
  }

  function save() {
    startTransition(async () => {
      const result = await saveTastesAction({
        preferredGenders: GENDER_CHOICES.filter((g) => groups.includes(g.id)).flatMap(
          (g) => g.genders,
        ),
        interests,
        lookingFor,
      });
      if (!result.ok) {
        toast.error(result.error ?? 'No se pudo guardar.');
        return;
      }
      const list = result.suggestions ?? [];
      if (list.length === 0) {
        toast.success('¡Listo! Tu Descubrir ya esta a tu gusto.');
        finish();
        return;
      }
      setSuggestions(list);
      setStep('follow');
    });
  }

  function next() {
    if (step === 'who') setStep('likes');
    else if (step === 'likes') setStep('looking');
    else if (step === 'looking') save();
    else finish();
  }

  function back() {
    if (step === 'likes') setStep('who');
    else if (step === 'looking') setStep('likes');
  }

  function follow(creator: SuggestedCreator) {
    // Optimista: el boton cambia al momento; si falla, vuelve atras.
    const wasFollowing = followed.has(creator.id);
    setFollowed((prev) => {
      const nextSet = new Set(prev);
      if (wasFollowing) nextSet.delete(creator.id);
      else nextSet.add(creator.id);
      return nextSet;
    });
    void toggleFollowAction(creator.id, creator.slug).then((r) => {
      if (!r.ok) {
        toast.error(r.error ?? 'No se pudo seguir.');
        setFollowed((prev) => {
          const nextSet = new Set(prev);
          if (wasFollowing) nextSet.add(creator.id);
          else nextSet.delete(creator.id);
          return nextSet;
        });
      }
    });
  }

  const titles: Record<Step, { title: string; hint: string }> = {
    who: {
      title: name ? `Hola, ${name.split(' ')[0]}. ¿A quien quieres ver?` : '¿A quien quieres ver?',
      hint: 'Elige una o varias. Si no eliges ninguna, te enseñamos de todo.',
    },
    likes: {
      title: '¿Que te gusta?',
      hint: 'Elige al menos 3 para que acertemos mas.',
    },
    looking: {
      title: '¿Que buscas aqui?',
      hint: 'Asi sabemos que enseñarte primero.',
    },
    follow: {
      title: 'Creadoras para ti',
      hint: 'Siguelas para ver lo que publican en Siguiendo.',
    },
  };

  const nextLabel =
    step === 'looking'
      ? 'Guardar'
      : step === 'follow'
        ? followed.size > 0
          ? `Empezar · sigues a ${followed.size}`
          : 'Empezar'
        : step === 'likes' && interests.length === 0
          ? 'Saltar este paso'
          : 'Siguiente';

  return (
    <div className="fixed inset-0 !m-0 z-[60] flex flex-col overflow-hidden bg-background">
      <div
        aria-hidden
        className="pointer-events-none absolute -right-32 -top-32 h-96 w-96 rounded-full bg-primary/25 blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-40 -left-24 h-96 w-96 rounded-full bg-champagne-gold/10 blur-3xl"
      />

      {/* Cabecera: atras, progreso, saltar */}
      <header className="relative mx-auto flex w-full max-w-xl items-center gap-3 px-4 pt-4">
        <Button
          variant="ghost"
          size="icon"
          onClick={back}
          disabled={step === 'who' || step === 'follow' || isPending}
          className={cn((step === 'who' || step === 'follow') && 'invisible')}
          aria-label="Atras"
        >
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex flex-1 gap-1.5" aria-label={`Paso ${stepIndex + 1} de 4`}>
          {[0, 1, 2, 3].map((i) => (
            <span
              key={i}
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-500',
                i <= stepIndex ? 'bg-primary' : 'bg-muted',
              )}
            />
          ))}
        </div>
        <Button
          variant="ghost"
          size="sm"
          onClick={step === 'follow' ? finish : skipAll}
          disabled={isPending}
          className="text-muted-foreground"
        >
          {isEditing && step !== 'follow' ? 'Cancelar' : 'Saltar'}
        </Button>
      </header>

      {/* Pregunta */}
      <main
        key={step}
        className="relative mx-auto min-h-0 w-full max-w-xl flex-1 overflow-y-auto px-5 pb-6 pt-6 animate-in fade-in slide-in-from-right-4 duration-300"
      >
        <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.2em] text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          {isEditing ? 'Tus gustos' : 'Bienvenida'}
        </p>
        <h1 className="mt-2 font-heading text-3xl uppercase leading-tight tracking-wide">
          {titles[step].title}
        </h1>
        <p className="mt-1.5 text-sm text-muted-foreground">{titles[step].hint}</p>

        {step === 'who' && (
          <div className="mt-6 grid grid-cols-2 gap-3">
            {GENDER_CHOICES.map((g) => {
              const on = groups.includes(g.id);
              const Icon = GENDER_ICONS[g.id] ?? Users;
              return (
                <button
                  key={g.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(groups, setGroups, g.id)}
                  className={cn(
                    'relative flex aspect-[5/4] flex-col items-start justify-end gap-1 rounded-3xl border p-4 text-left transition-all active:scale-[0.97]',
                    on
                      ? 'border-primary bg-primary/15 shadow-[0_0_40px_-12px_hsl(var(--primary))]'
                      : 'border-border/60 bg-card hover:border-muted-foreground/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-12 w-12 items-center justify-center rounded-2xl transition-colors',
                      on ? 'bg-primary text-white' : 'bg-primary/10 text-primary',
                    )}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="font-semibold">{g.label}</span>
                  {on && <CheckBadge />}
                </button>
              );
            })}
          </div>
        )}

        {step === 'likes' && (
          <>
            <div className="mt-6 flex flex-wrap gap-2">
              {TASTE_TAGS.map((tag) => {
                const on = interests.includes(tag.id);
                const Icon = TAG_ICONS[tag.id] ?? Sparkles;
                return (
                  <button
                    key={tag.id}
                    type="button"
                    aria-pressed={on}
                    onClick={() => toggle(interests, setInterests, tag.id)}
                    className={cn(
                      'flex items-center gap-2 rounded-full border px-4 py-2.5 text-sm font-medium transition-all active:scale-95',
                      on
                        ? 'border-primary bg-primary text-primary-foreground'
                        : 'border-border/60 bg-card hover:border-muted-foreground/50',
                    )}
                  >
                    <Icon className={cn('h-4 w-4', !on && 'text-primary')} />
                    {tag.label}
                  </button>
                );
              })}
            </div>
            <p
              className={cn(
                'mt-4 text-xs',
                interests.length >= 3 ? 'text-state-connected' : 'text-muted-foreground',
              )}
            >
              {interests.length >= 3
                ? `¡Perfecto! ${interests.length} elegidas`
                : `${interests.length} de 3`}
            </p>
          </>
        )}

        {step === 'looking' && (
          <div className="mt-6 space-y-3">
            {LOOKING_FOR_CHOICES.map((c) => {
              const on = lookingFor.includes(c.id);
              const Icon = LOOKING_ICONS[c.id] ?? Sparkles;
              return (
                <button
                  key={c.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(lookingFor, setLookingFor, c.id)}
                  className={cn(
                    'relative flex w-full items-center gap-4 rounded-2xl border p-4 text-left transition-all active:scale-[0.98]',
                    on
                      ? 'border-primary bg-primary/15'
                      : 'border-border/60 bg-card hover:border-muted-foreground/50',
                  )}
                >
                  <span
                    className={cn(
                      'flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-colors',
                      on ? 'bg-primary text-white' : 'bg-primary/10 text-primary',
                    )}
                  >
                    <Icon className="h-6 w-6" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block font-semibold">{c.label}</span>
                    <span className="block text-xs text-muted-foreground">{c.hint}</span>
                  </span>
                  <span
                    className={cn(
                      'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2',
                      on ? 'border-primary bg-primary text-white' : 'border-muted-foreground/40',
                    )}
                  >
                    {on && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        )}

        {step === 'follow' && (
          <ul className="mt-6 space-y-2">
            {suggestions.map((c) => {
              const on = followed.has(c.id);
              return (
                <li
                  key={c.id}
                  className="flex items-center gap-3 rounded-2xl border border-border/60 bg-card p-3"
                >
                  <span
                    className={cn(
                      'shrink-0 rounded-full p-[2px]',
                      c.isLive
                        ? 'bg-rose-500'
                        : 'bg-gradient-to-tr from-primary via-fantazy-red to-champagne-gold',
                    )}
                  >
                    <Avatar className="h-12 w-12 border-2 border-card">
                      {c.avatarUrl && <AvatarImage src={c.avatarUrl} alt="" />}
                      <AvatarFallback>{initials(c.stageName)}</AvatarFallback>
                    </Avatar>
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5 truncate font-semibold">
                      {c.stageName}
                      {c.isLive && (
                        <span className="flex items-center gap-0.5 rounded bg-rose-500 px-1 text-[9px] font-bold uppercase text-white">
                          <Radio className="h-2.5 w-2.5" /> En vivo
                        </span>
                      )}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {c.tags.length > 0
                        ? c.tags
                            .map((t) => TASTE_TAGS.find((x) => x.id === t))
                            .filter(Boolean)
                            .map((t) => t!.label)
                            .join(' · ')
                        : (c.headline ??
                          `${c.followersCount} ${c.followersCount === 1 ? 'seguidor' : 'seguidores'}`)}
                    </span>
                  </span>
                  <Button
                    size="sm"
                    variant={on ? 'outline' : 'brand'}
                    onClick={() => follow(c)}
                    className="shrink-0"
                  >
                    {on ? <Check className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
                    {on ? 'Siguiendo' : 'Seguir'}
                  </Button>
                </li>
              );
            })}
          </ul>
        )}
      </main>

      {/* Accion principal, a mano del pulgar */}
      <footer className="relative mx-auto w-full max-w-xl shrink-0 border-t border-border/60 bg-background/90 p-4 backdrop-blur">
        <Button
          variant="brand"
          size="lg"
          className="h-12 w-full"
          onClick={next}
          disabled={isPending}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          {nextLabel}
        </Button>
      </footer>
    </div>
  );
}

function CheckBadge() {
  return (
    <span className="absolute right-3 top-3 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-white animate-in zoom-in-50">
      <Check className="h-3.5 w-3.5" strokeWidth={3} />
    </span>
  );
}
