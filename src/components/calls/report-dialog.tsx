'use client';

import { useState, useTransition } from 'react';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { ReportReason } from '@prisma/client';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { REPORT_REASON_LABELS } from '@/lib/constants';
import { reportUserAction } from '@/server/actions/calls';

export function ReportDialog({
  open,
  onOpenChange,
  reportedId,
  reportedName,
  sessionId,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reportedId: string;
  reportedName: string;
  sessionId?: string;
}) {
  const [reason, setReason] = useState<ReportReason | ''>('');
  const [details, setDetails] = useState('');
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (!reason) {
      toast.error('Selecciona un motivo.');
      return;
    }

    startTransition(async () => {
      const result = await reportUserAction({
        reportedId,
        sessionId,
        reason: reason as any,
        details: details.trim() || undefined,
      });

      if (result.ok) {
        toast.success(
          'Reporte enviado. El equipo de moderacion lo revisara y no volveras a coincidir con esta persona.',
        );
        onOpenChange(false);
        setReason('');
        setDetails('');
      } else {
        toast.error(result.error ?? 'No se pudo enviar el reporte');
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reportar a {reportedName}</DialogTitle>
          <DialogDescription>
            Los reportes son confidenciales. Si detectas contenido con menores o
            no consentido, marcalo como urgente: se revisa de forma prioritaria.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label>Motivo</Label>
            <Select value={reason} onValueChange={(v) => setReason(v as ReportReason)}>
              <SelectTrigger>
                <SelectValue placeholder="Selecciona un motivo" />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(REPORT_REASON_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="details">Detalles (opcional)</Label>
            <Textarea
              id="details"
              value={details}
              onChange={(e) => setDetails(e.target.value)}
              maxLength={500}
              placeholder="Describe brevemente lo ocurrido..."
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button variant="destructive" onClick={submit} disabled={isPending}>
            {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
            Enviar reporte
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
