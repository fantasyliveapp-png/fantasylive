'use client';

import { useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Loader2, Upload } from 'lucide-react';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  requestKycUploadUrlAction,
  submitKycAction,
} from '@/server/actions/model';

type DocKind = 'front' | 'back' | 'selfie' | 'note';

const DOC_LABELS: Record<DocKind, { title: string; hint: string; required: boolean }> = {
  front: {
    title: 'Documento (anverso)',
    hint: 'Pasaporte, DNI o carnet de conducir. Debe leerse con claridad.',
    required: true,
  },
  back: {
    title: 'Documento (reverso)',
    hint: 'No necesario si envias un pasaporte.',
    required: false,
  },
  selfie: {
    title: 'Selfie con el documento',
    hint: 'Tu cara y el documento visibles en la misma foto.',
    required: true,
  },
  note: {
    title: 'Nota manuscrita',
    hint: 'Papel con "FantasyLive" y la fecha de hoy, escrito a mano.',
    required: false,
  },
};

export function KycForm({
  storageReady,
  defaultName,
  defaultCountry,
}: {
  storageReady: boolean;
  defaultName: string;
  defaultCountry: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [fullLegalName, setFullLegalName] = useState(defaultName);
  const [birthDate, setBirthDate] = useState('');
  const [country, setCountry] = useState(defaultCountry);
  const [documentType, setDocumentType] = useState<
    'PASSPORT' | 'NATIONAL_ID' | 'DRIVERS_LICENSE'
  >('NATIONAL_ID');
  const [documentNumber, setDocumentNumber] = useState('');
  const [keys, setKeys] = useState<Partial<Record<DocKind, string>>>({});
  const [uploading, setUploading] = useState<DocKind | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const targetKindRef = useRef<DocKind | null>(null);

  const maxBirthDate = new Date();
  maxBirthDate.setFullYear(maxBirthDate.getFullYear() - 18);

  function pickFile(kind: DocKind) {
    if (!storageReady) {
      toast.error(
        'El almacenamiento no esta configurado. Define S3_* en tu .env para poder subir documentos.',
      );
      return;
    }
    targetKindRef.current = kind;
    fileInputRef.current?.click();
  }

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    const kind = targetKindRef.current;
    if (!file || !kind) return;

    setUploading(kind);

    try {
      const urlResult = await requestKycUploadUrlAction({
        kind,
        filename: file.name,
        contentType: file.type || 'image/jpeg',
      });

      if (!urlResult.ok || !urlResult.data) {
        toast.error(urlResult.error ?? 'No se pudo preparar la subida');
        return;
      }

      const upload = await fetch(urlResult.data.uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': file.type || 'image/jpeg' },
      });

      if (!upload.ok) {
        toast.error('Fallo al subir el archivo');
        return;
      }

      setKeys((prev) => ({ ...prev, [kind]: urlResult.data!.key }));
      toast.success(`${DOC_LABELS[kind].title} subido`);
    } catch {
      toast.error('Error subiendo el documento');
    } finally {
      setUploading(null);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  function submit() {
    if (!keys.front || !keys.selfie) {
      toast.error('Sube al menos el anverso del documento y el selfie.');
      return;
    }
    if (!birthDate) {
      toast.error('Indica tu fecha de nacimiento.');
      return;
    }

    startTransition(async () => {
      const result = await submitKycAction({
        fullLegalName,
        birthDate,
        country,
        documentType,
        documentNumber: documentNumber || undefined,
        documentFrontKey: keys.front!,
        documentBackKey: keys.back,
        selfieKey: keys.selfie!,
        handwrittenNoteKey: keys.note,
      });

      if (result.ok) {
        toast.success(result.message ?? 'Documentacion enviada');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo enviar la verificacion');
      }
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Enviar documentacion</CardTitle>
        <CardDescription>
          Los datos deben coincidir exactamente con los del documento oficial.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-6">
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*,application/pdf"
          className="hidden"
          onChange={handleFile}
        />

        {!storageReady && (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-4 py-3 text-sm text-amber-500">
            El almacenamiento seguro no esta configurado. Define las variables
            S3_* en tu <code>.env</code> (MinIO local viene incluido en
            docker-compose) para poder subir documentos.
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="fullLegalName">Nombre legal completo</Label>
            <Input
              id="fullLegalName"
              value={fullLegalName}
              onChange={(e) => setFullLegalName(e.target.value)}
              placeholder="Como aparece en tu documento"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="birthDate">Fecha de nacimiento</Label>
            <Input
              id="birthDate"
              type="date"
              value={birthDate}
              max={maxBirthDate.toISOString().slice(0, 10)}
              onChange={(e) => setBirthDate(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="country">Pais de emision</Label>
            <Input
              id="country"
              value={country}
              onChange={(e) => setCountry(e.target.value)}
              placeholder="Espana"
            />
          </div>

          <div className="space-y-2">
            <Label>Tipo de documento</Label>
            <Select
              value={documentType}
              onValueChange={(v) => setDocumentType(v as any)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="NATIONAL_ID">DNI / Documento nacional</SelectItem>
                <SelectItem value="PASSPORT">Pasaporte</SelectItem>
                <SelectItem value="DRIVERS_LICENSE">Carnet de conducir</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="documentNumber">Numero de documento (opcional)</Label>
            <Input
              id="documentNumber"
              value={documentNumber}
              onChange={(e) => setDocumentNumber(e.target.value)}
            />
          </div>
        </div>

        <div className="space-y-3">
          <Label>Documentos</Label>
          <div className="grid gap-3 sm:grid-cols-2">
            {(Object.keys(DOC_LABELS) as DocKind[]).map((kind) => {
              const meta = DOC_LABELS[kind];
              const uploaded = Boolean(keys[kind]);

              return (
                <button
                  key={kind}
                  type="button"
                  onClick={() => pickFile(kind)}
                  disabled={uploading !== null}
                  className={`flex items-start gap-3 rounded-lg border p-3 text-left transition-colors ${
                    uploaded
                      ? 'border-emerald-600/50 bg-emerald-600/5'
                      : 'border-border hover:border-primary/50'
                  }`}
                >
                  <div
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                      uploaded ? 'bg-emerald-600/15' : 'bg-muted'
                    }`}
                  >
                    {uploading === kind ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : uploaded ? (
                      <Check className="h-4 w-4 text-emerald-500" />
                    ) : (
                      <Upload className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="text-sm font-medium">
                      {meta.title}
                      {meta.required && (
                        <span className="ml-1 text-destructive">*</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {meta.hint}
                    </p>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="rounded-lg bg-muted/50 p-3 text-xs text-muted-foreground">
          Al enviar declaras que eres mayor de 18 anos, que la documentacion es
          autentica y que consientes su verificacion y conservacion conforme a
          18 U.S.C. 2257 y la normativa de proteccion de datos aplicable.
        </div>

        <Button
          variant="brand"
          size="lg"
          onClick={submit}
          disabled={isPending || !storageReady}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Enviar para revision
        </Button>
      </CardContent>
    </Card>
  );
}
