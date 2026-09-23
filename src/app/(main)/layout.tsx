import { BottomNav } from '@/components/layout/bottom-nav';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { getCurrentUser } from '@/lib/auth/guards';
import { getOwnUsername, getProfileShortcut } from '@/lib/profile-shortcut';

export default async function MainLayout({
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
    <div className="flex min-h-screen flex-col">
      <Navbar />
      {/* pb-16 en movil deja sitio a la barra inferior fija. */}
      <main className="flex-1 pb-16 md:pb-0">{children}</main>
      <Footer />
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
