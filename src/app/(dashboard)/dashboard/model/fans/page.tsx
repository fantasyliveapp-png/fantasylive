import type { Metadata } from 'next';

import { FansList } from '@/components/model/fans-list';
import { requireModel } from '@/lib/auth/guards';
import { getCreatorFans } from '@/lib/fans';

export const metadata: Metadata = { title: 'Mis fans' };
export const dynamic = 'force-dynamic';

/** FANS: quien te sigue, cuanto te apoya y si esta suscrito. Solo lo ves tu. */
export default async function FansPage() {
  const { user, profile } = await requireModel();
  const fans = await getCreatorFans(profile.id, user.id);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-heading text-3xl uppercase tracking-wide">Mis fans</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quién te sigue, cuánto te ha apoyado y quién está suscrito. Escríbeles para cuidarles: solo
          tú ves esta lista.
        </p>
      </div>
      <FansList fans={fans} />
    </div>
  );
}
