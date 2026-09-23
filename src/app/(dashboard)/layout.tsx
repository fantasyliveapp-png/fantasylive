import { BottomNav } from '@/components/layout/bottom-nav';
import { Navbar } from '@/components/layout/navbar';
import { SideNavServer } from '@/components/layout/side-nav-server';
import { getCurrentUser } from '@/lib/auth/guards';
import { getOwnUsername, getProfileShortcut } from '@/lib/profile-shortcut';

export default async function DashboardGroupLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const [profile, username] = await Promise.all([
    getProfileShortcut(user?.modelProfileId),
    getOwnUsername(user?.id),
  ]);

  return (
    <div className="flex min-h-screen flex-col lg:pl-60">
      <SideNavServer />
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
        username={username}
      />
    </div>
  );
}
