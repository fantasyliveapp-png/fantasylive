'use client';

import { useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import {
  Ban,
  Coins,
  Crown,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
  ShieldOff,
} from 'lucide-react';
import { toast } from 'sonner';

import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Textarea } from '@/components/ui/textarea';
import {
  KYC_STATUS_LABELS,
  ROLE_LABELS,
  USER_STATUS_LABELS,
} from '@/lib/constants';
import { moderateUserAction } from '@/server/actions/admin';
import { adminAdjustBalanceAction } from '@/server/actions/wallet';
import { formatDate, formatTokens, initials, relativeTime } from '@/lib/utils';

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  image: string | null;
  role: string;
  status: string;
  isVip: boolean;
  country: string | null;
  createdAt: string;
  lastSeenAt: string | null;
  banReason: string | null;
  balance: number;
  lifetimeSpent: number;
  stageName: string | null;
  slug: string | null;
  kycStatus: string | null;
  isOnline: boolean;
}

const STATUS_VARIANT: Record<string, any> = {
  ACTIVE: 'success',
  SUSPENDED: 'warning',
  BANNED: 'destructive',
  PENDING_VERIFICATION: 'muted',
};

export function UserModerationTable({
  users,
  page,
  totalPages,
}: {
  users: UserRow[];
  page: number;
  totalPages: number;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const [moderating, setModerating] = useState<{
    user: UserRow;
    action: 'SUSPEND' | 'BAN';
  } | null>(null);
  const [reason, setReason] = useState('');
  const [hours, setHours] = useState(72);

  const [adjusting, setAdjusting] = useState<UserRow | null>(null);
  const [adjustTokens, setAdjustTokens] = useState(0);
  const [adjustReason, setAdjustReason] = useState('');

  function setParam(key: string, value: string | null) {
    const params = new URLSearchParams(searchParams.toString());
    if (!value || value === 'all') params.delete(key);
    else params.set(key, value);
    params.delete('page');
    router.push(`${pathname}?${params.toString()}`);
  }

  function moderate(
    userId: string,
    action: 'SUSPEND' | 'BAN' | 'REINSTATE' | 'PROMOTE_VIP' | 'DEMOTE_VIP',
    extra?: { reason?: string; suspensionHours?: number },
  ) {
    startTransition(async () => {
      const result = await moderateUserAction({ userId, action, ...extra });
      if (result.ok) {
        toast.success(result.message ?? 'Accion aplicada');
        setModerating(null);
        setReason('');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo aplicar la accion');
      }
    });
  }

  function adjustBalance() {
    if (!adjusting || adjustTokens === 0) return;
    startTransition(async () => {
      const result = await adminAdjustBalanceAction({
        userId: adjusting.id,
        tokens: adjustTokens,
        reason: adjustReason || 'Ajuste manual de administracion',
      });
      if (result.ok) {
        toast.success(result.message ?? 'Saldo ajustado');
        setAdjusting(null);
        setAdjustTokens(0);
        setAdjustReason('');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo ajustar el saldo');
      }
    });
  }

  return (
    <>
      {/* Filtros */}
      <div className="flex flex-wrap items-center gap-3">
        <form
          className="relative min-w-[240px] flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            setParam('q', String(new FormData(e.currentTarget).get('q') ?? ''));
          }}
        >
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            name="q"
            defaultValue={searchParams.get('q') ?? ''}
            placeholder="Buscar por email, nombre o usuario..."
            className="pl-9"
          />
        </form>

        <Select
          value={searchParams.get('role') ?? 'all'}
          onValueChange={(v) => setParam('role', v)}
        >
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Rol" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los roles</SelectItem>
            <SelectItem value="USER">Usuarios</SelectItem>
            <SelectItem value="MODEL">Modelos</SelectItem>
            <SelectItem value="ADMIN">Admins</SelectItem>
          </SelectContent>
        </Select>

        <Select
          value={searchParams.get('status') ?? 'all'}
          onValueChange={(v) => setParam('status', v)}
        >
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Estado" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos los estados</SelectItem>
            <SelectItem value="ACTIVE">Activos</SelectItem>
            <SelectItem value="SUSPENDED">Suspendidos</SelectItem>
            <SelectItem value="BANNED">Baneados</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Tabla */}
      <div className="rounded-xl border border-border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Cuenta</TableHead>
              <TableHead>Rol</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="text-right">Saldo</TableHead>
              <TableHead>Registro</TableHead>
              <TableHead className="w-10" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <Avatar className="h-9 w-9">
                      {user.image && <AvatarImage src={user.image} alt="" />}
                      <AvatarFallback>{initials(user.name)}</AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        {user.slug ? (
                          <Link
                            href={`/models/${user.slug}`}
                            target="_blank"
                            className="truncate text-sm font-medium hover:underline"
                          >
                            {user.stageName ?? user.name}
                          </Link>
                        ) : (
                          <span className="truncate text-sm font-medium">
                            {user.name ?? 'Sin nombre'}
                          </span>
                        )}
                        {user.isVip && <Crown className="h-3.5 w-3.5 text-primary" />}
                        {user.isOnline && (
                          <span className="live-dot !h-2 !w-2" />
                        )}
                      </div>
                      <p className="truncate text-xs text-muted-foreground">
                        {user.email}
                        {user.country ? ` · ${user.country}` : ''}
                      </p>
                      {user.banReason && (
                        <p className="truncate text-xs text-destructive">
                          {user.banReason}
                        </p>
                      )}
                    </div>
                  </div>
                </TableCell>

                <TableCell>
                  <div className="flex flex-col gap-1">
                    <Badge variant="muted">{ROLE_LABELS[user.role as keyof typeof ROLE_LABELS]}</Badge>
                    {user.kycStatus && (
                      <Badge
                        variant={
                          user.kycStatus === 'APPROVED'
                            ? 'success'
                            : user.kycStatus === 'PENDING'
                              ? 'warning'
                              : 'muted'
                        }
                        className="text-[10px]"
                      >
                        {KYC_STATUS_LABELS[user.kycStatus as keyof typeof KYC_STATUS_LABELS]}
                      </Badge>
                    )}
                  </div>
                </TableCell>

                <TableCell>
                  <Badge variant={STATUS_VARIANT[user.status] ?? 'muted'}>
                    {USER_STATUS_LABELS[user.status as keyof typeof USER_STATUS_LABELS]}
                  </Badge>
                </TableCell>

                <TableCell className="text-right">
                  <p className="font-semibold text-token">
                    {formatTokens(user.balance)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    gastado {formatTokens(user.lifetimeSpent)}
                  </p>
                </TableCell>

                <TableCell className="text-xs text-muted-foreground">
                  <p>{formatDate(new Date(user.createdAt))}</p>
                  {user.lastSeenAt && (
                    <p>visto {relativeTime(new Date(user.lastSeenAt))}</p>
                  )}
                </TableCell>

                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" disabled={isPending}>
                        {isPending ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreHorizontal className="h-4 w-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>

                    <DropdownMenuContent align="end" className="w-52">
                      <DropdownMenuLabel>Moderacion</DropdownMenuLabel>

                      {user.status === 'ACTIVE' ? (
                        <>
                          <DropdownMenuItem
                            onClick={() => setModerating({ user, action: 'SUSPEND' })}
                          >
                            <ShieldOff /> Suspender
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive focus:text-destructive"
                            onClick={() => setModerating({ user, action: 'BAN' })}
                          >
                            <Ban /> Banear
                          </DropdownMenuItem>
                        </>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => moderate(user.id, 'REINSTATE')}
                        >
                          <RotateCcw /> Reactivar cuenta
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />
                      <DropdownMenuLabel>Privilegios</DropdownMenuLabel>

                      {user.isVip ? (
                        <DropdownMenuItem
                          onClick={() => moderate(user.id, 'DEMOTE_VIP')}
                        >
                          <Crown /> Quitar VIP
                        </DropdownMenuItem>
                      ) : (
                        <DropdownMenuItem
                          onClick={() => moderate(user.id, 'PROMOTE_VIP')}
                        >
                          <Crown /> Promover a VIP
                        </DropdownMenuItem>
                      )}

                      <DropdownMenuSeparator />
                      <DropdownMenuItem onClick={() => setAdjusting(user)}>
                        <Coins /> Ajustar saldo
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {totalPages > 1 && (
        <nav className="flex items-center justify-center gap-2">
          {Array.from({ length: totalPages }, (_, i) => i + 1).map((p) => (
            <Button
              key={p}
              variant={p === page ? 'default' : 'outline'}
              size="sm"
              onClick={() => setParam('page', String(p))}
            >
              {p}
            </Button>
          ))}
        </nav>
      )}

      {/* Dialogo de suspension / baneo */}
      <Dialog
        open={Boolean(moderating)}
        onOpenChange={(o) => !o && setModerating(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {moderating?.action === 'BAN' ? 'Banear cuenta' : 'Suspender cuenta'}
            </DialogTitle>
            <DialogDescription>
              {moderating?.action === 'BAN'
                ? 'El baneo es permanente. La cuenta perdera el acceso y las emisiones se cortaran de inmediato.'
                : 'La suspension es temporal. La cuenta se reactivara automaticamente al vencer el plazo.'}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">
                {moderating?.user.stageName ?? moderating?.user.name}
              </p>
              <p className="text-xs text-muted-foreground">
                {moderating?.user.email}
              </p>
            </div>

            {moderating?.action === 'SUSPEND' && (
              <div className="space-y-2">
                <Label htmlFor="hours">Duracion (horas)</Label>
                <Input
                  id="hours"
                  type="number"
                  min={1}
                  value={hours}
                  onChange={(e) => setHours(Number(e.target.value))}
                />
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="modReason">Motivo</Label>
              <Textarea
                id="modReason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Describe el motivo de la sancion..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setModerating(null)}>
              Cancelar
            </Button>
            <Button
              variant="destructive"
              disabled={isPending}
              onClick={() =>
                moderating &&
                moderate(moderating.user.id, moderating.action, {
                  reason,
                  suspensionHours: hours,
                })
              }
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Confirmar
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Dialogo de ajuste de saldo */}
      <Dialog open={Boolean(adjusting)} onOpenChange={(o) => !o && setAdjusting(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Ajustar saldo</DialogTitle>
            <DialogDescription>
              Usa valores positivos para acreditar y negativos para debitar. Todo
              ajuste queda registrado en el log de auditoria.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="rounded-lg border border-border p-3">
              <p className="text-sm font-medium">{adjusting?.name}</p>
              <p className="text-xs text-muted-foreground">
                Saldo actual: {formatTokens(adjusting?.balance ?? 0)} tokens
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="tokens">Tokens</Label>
              <Input
                id="tokens"
                type="number"
                value={adjustTokens}
                onChange={(e) => setAdjustTokens(Number(e.target.value))}
                placeholder="Ej: 100 o -50"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="adjReason">Motivo</Label>
              <Input
                id="adjReason"
                value={adjustReason}
                onChange={(e) => setAdjustReason(e.target.value)}
                placeholder="Ej: compensacion por incidencia tecnica"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="ghost" onClick={() => setAdjusting(null)}>
              Cancelar
            </Button>
            <Button
              variant="brand"
              onClick={adjustBalance}
              disabled={isPending || adjustTokens === 0}
            >
              {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
              Aplicar ajuste
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
