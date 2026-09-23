import { BottomNav } from '@/components/layout/bottom-nav';
import { Navbar } from '@/components/layout/navbar';
import { getCurrentUser } from '@/lib/auth/guards';
import { getProfileShortcut } from '@/lib/profile-shortcut';

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const profile = await getProfileShortcut(user?.modelProfileId);

  return (
    <div className="flex min-h-screen flex-col">
      <Navbar />
      {/* Misma barra inferior que el resto de la app: en movil el panel no
          debe ser un callejon sin salida. */}
      <div className="flex-1 pb-16 md:pb-0">{children}</div>
      <BottomNav
        isAuthenticated={Boolean(user)}
        isModel={user?.role === 'MODEL'}
        userName={user?.name}
        userImage={user?.image}
        profile={profile}
      />
    </div>
  );
}
