import { CreatorShell } from '@/components/model/creator-shell';
import { requireModel } from '@/lib/auth/guards';

export const dynamic = 'force-dynamic';

export default async function ModelDashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const { user, profile } = await requireModel();
  return (
    <CreatorShell userId={user.id} profile={profile}>
      {children}
    </CreatorShell>
  );
}
