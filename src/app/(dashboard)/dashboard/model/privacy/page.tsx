import type { Metadata } from 'next';
import { Info } from 'lucide-react';

import { CountryBlockManager } from '@/components/model/country-block-manager';
import { Card, CardContent } from '@/components/ui/card';
import { requireModel } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Privacidad y bloqueos' };
export const dynamic = 'force-dynamic';

export default async function PrivacyPage() {
  const { profile } = await requireModel();

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">
          Privacidad y bloqueos
        </h1>
        <p className="mt-2 text-muted-foreground">
          Controla desde que paises se puede ver tu perfil.
        </p>
      </div>

      <CountryBlockManager initialCountries={profile.blockedCountries} />

      <Card>
        <CardContent className="flex gap-3 pt-6">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="space-y-2 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Como funciona</p>
            <p>
              El pais se deduce de la conexion de quien visita la web. Si
              bloqueas un pais, desde alli tu perfil no aparece en el catalogo,
              tu pagina responde como si no existiera, no te pueden reservar,
              escribir, suscribirse ni desbloquear tu contenido, y el
              emparejamiento aleatorio nunca te asigna a esa persona.
            </p>
            <p>
              Ten en cuenta que quien use una VPN puede aparentar estar en otro
              pais: el bloqueo geografico es una capa mas de privacidad, no una
              garantia absoluta. Para casos concretos, usa el boton de reportar
              y bloquear durante la llamada.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
