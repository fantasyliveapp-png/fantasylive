import type { Metadata } from 'next';

import { CreatorHome } from '@/components/model/creator-home';
import { requireModel } from '@/lib/auth/guards';

export const metadata: Metadata = { title: 'Mi panel' };
export const dynamic = 'force-dynamic';

export default async function ModelOverviewPage() {
  const { user, profile } = await requireModel();
  return <CreatorHome userId={user.id} profile={profile} />;
}
