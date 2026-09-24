'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AtSign, Check, Loader2, LogOut, Trash2, X } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  inviteChatterAction,
  leaveTeamAction,
  removeChatterAction,
  respondTeamInviteAction,
  updateChatterPercentAction,
  type TeamActionResult,
} from '@/server/actions/chat-team';

function useRun() {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  function run(fn: () => Promise<TeamActionResult>, onOk?: () => void) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        if (result.message) toast.success(result.message);
        onOk?.();
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo completar.');
      }
    });
  }
  return { run, isPending };
}

/** Creadora: invitar a alguien por su @usuario con su %. */
export function InviteChatterForm({ maxPercent }: { maxPercent: number }) {
  const { run, isPending } = useRun();
  const [username, setUsername] = useState('');
  const [percent, setPercent] = useState(20);

  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        if (!username.trim()) return;
        run(
          () => inviteChatterAction({ username, percent }),
          () => setUsername(''),
        );
      }}
    >
      <div className="relative">
        <AtSign className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={username}
          onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s/g, ''))}
          placeholder="usuario de la persona"
          className="pl-9"
          autoCapitalize="none"
          spellCheck={false}
        />
      </div>
      <PercentPicker value={percent} onChange={setPercent} max={maxPercent} />
      <Button
        type="submit"
        variant="brand"
        className="w-full"
        disabled={isPending || !username.trim()}
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        Invitar
      </Button>
    </form>
  );
}

function PercentPicker({
  value,
  onChange,
  max,
}: {
  value: number;
  onChange: (v: number) => void;
  max: number;
}) {
  return (
    <label className="block space-y-1.5">
      <span className="flex items-baseline justify-between text-sm">
        <span className="font-medium">Su comision</span>
        <span className="font-heading text-2xl">{value}%</span>
      </span>
      <input
        type="range"
        min={0}
        max={max}
        step={5}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-[hsl(var(--primary))]"
      />
      <span className="block text-xs text-muted-foreground">
        De lo que tu ganas en cada venta que haga en tus chats. Ejemplo: vende algo de $10, tu ganas
        $6 y le tocan {`$${((6 * value) / 100).toFixed(2)}`}.
      </span>
    </label>
  );
}

/** Creadora: cambiar el % o quitar a un miembro. */
export function MemberControls({
  id,
  percent,
  maxPercent,
}: {
  id: string;
  percent: number;
  maxPercent: number;
}) {
  const { run, isPending } = useRun();
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [value, setValue] = useState(percent);

  if (editing) {
    return (
      <div className="space-y-2 pt-2">
        <PercentPicker value={value} onChange={setValue} max={maxPercent} />
        <div className="flex gap-2">
          <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
            Cancelar
          </Button>
          <Button
            size="sm"
            variant="brand"
            disabled={isPending || value === percent}
            onClick={() =>
              run(
                () => updateChatterPercentAction({ id, percent: value }),
                () => setEditing(false),
              )
            }
          >
            Guardar
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex gap-2">
      <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
        Cambiar %
      </Button>
      {confirming ? (
        <Button
          size="sm"
          variant="destructive"
          disabled={isPending}
          onClick={() => run(() => removeChatterAction(id))}
          onBlur={() => setConfirming(false)}
        >
          <Trash2 className="h-4 w-4" />
          Si, quitar
        </Button>
      ) : (
        <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
          <Trash2 className="h-4 w-4" />
          Quitar
        </Button>
      )}
    </div>
  );
}

/** Chatter: aceptar o rechazar una invitacion. */
export function InviteResponse({ id }: { id: string }) {
  const { run, isPending } = useRun();
  return (
    <div className="flex gap-2">
      <Button
        size="sm"
        variant="ghost"
        disabled={isPending}
        onClick={() => run(() => respondTeamInviteAction({ id, accept: false }))}
      >
        <X className="h-4 w-4" />
        Rechazar
      </Button>
      <Button
        size="sm"
        variant="brand"
        disabled={isPending}
        onClick={() => run(() => respondTeamInviteAction({ id, accept: true }))}
      >
        <Check className="h-4 w-4" />
        Aceptar
      </Button>
    </div>
  );
}

/** Chatter: salir de un equipo. */
export function LeaveTeamButton({ id }: { id: string }) {
  const { run, isPending } = useRun();
  const [confirming, setConfirming] = useState(false);
  return confirming ? (
    <Button
      size="sm"
      variant="destructive"
      disabled={isPending}
      onClick={() => run(() => leaveTeamAction(id))}
      onBlur={() => setConfirming(false)}
    >
      <LogOut className="h-4 w-4" />
      Si, salir
    </Button>
  ) : (
    <Button size="sm" variant="ghost" onClick={() => setConfirming(true)}>
      <LogOut className="h-4 w-4" />
      Salir
    </Button>
  );
}
