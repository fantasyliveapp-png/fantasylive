import type { Metadata } from 'next';

import { ReachView } from '@/components/model/reach-view';
import { requireModel } from '@/lib/auth/guards';
import { getCreatorReach } from '@/lib/creator-reach';

export const metadata: Metadata = { title: 'Alcance' };
export const dynamic = 'force-dynamic';

export default async function ReachPage() {
  const { profile } = await requireModel();
  const reach = await getCreatorReach(profile.id);
  return <ReachView reach={reach} />;
}
