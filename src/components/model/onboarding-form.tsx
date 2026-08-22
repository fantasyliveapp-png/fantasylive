'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import type { Gender, Orientation } from '@prisma/client';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { GENDER_LABELS, ORIENTATION_LABELS } from '@/lib/constants';
import { createModelProfileAction } from '@/server/actions/onboarding';

export function OnboardingForm({
  defaultName,
  defaultGender,
  defaultOrientation,
  defaultCountry,
}: {
  defaultName: string;
  defaultGender: Gender;
  defaultOrientation: Orientation;
  defaultCountry: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [stageName, setStageName] = useState(defaultName);
  const [gender, setGender] = useState<Gender>(defaultGender);
  const [orientation, setOrientation] = useState<Orientation>(defaultOrientation);
  const [country, setCountry] = useState(defaultCountry);
  const [headline, setHeadline] = useState('');
  const [bio, setBio] = useState('');

  function submit() {
    if (stageName.trim().length < 2) {
      toast.error('Elige un nombre artistico.');
      return;
    }

    startTransition(async () => {
      const result = await createModelProfileAction({
        stageName: stageName.trim(),
        gender,
        orientation,
        country: country.trim() || undefined,
        headline: headline.trim() || undefined,
        bio: bio.trim() || undefined,
      });

      if (result.ok) {
        toast.success('Perfil creado. Ahora completa tu verificacion KYC.');
        router.push('/dashboard/model/kyc');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo crear el perfil');
      }
    });
  }

  return (
    <Card>
      <CardContent className="space-y-5 pt-6">
        <div className="space-y-2">
          <Label htmlFor="stageName">Nombre artistico</Label>
          <Input
            id="stageName"
            value={stageName}
            onChange={(e) => setStageName(e.target.value)}
            maxLength={40}
            placeholder="Como quieres que te conozcan"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label>Genero</Label>
            <Select value={gender} onValueChange={(v) => setGender(v as Gender)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(GENDER_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-2">
            <Label>Orientacion</Label>
            <Select
              value={orientation}
              onValueChange={(v) => setOrientation(v as Orientation)}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(ORIENTATION_LABELS).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="country">Pais</Label>
          <Input
            id="country"
            value={country}
            onChange={(e) => setCountry(e.target.value)}
            placeholder="Espana"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="headline">Titular</Label>
          <Input
            id="headline"
            value={headline}
            onChange={(e) => setHeadline(e.target.value)}
            maxLength={120}
            placeholder="Una frase que te describa"
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio">Biografia</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={1200}
            className="min-h-[120px]"
            placeholder="Cuentanos sobre ti..."
          />
        </div>

        <Button
          variant="brand"
          size="lg"
          className="w-full"
          onClick={submit}
          disabled={isPending}
        >
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Crear perfil y continuar al KYC
        </Button>
      </CardContent>
    </Card>
  );
}
