import { CallAvailabilityProvider } from '@/components/calls/call-availability';
import { BottomNav } from '@/components/layout/bottom-nav';
import { Footer } from '@/components/layout/footer';
import { Navbar } from '@/components/layout/navbar';
import { SideNavServer } from '@/components/layout/side-nav-server';
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

  const page = (
    // En escritorio grande la navegacion es la barra lateral (SideNav): el
    // contenido deja su ancho a la izquierda y la barra de arriba se oculta.
    <div className="flex min-h-screen flex-col md:pl-[72px] lg:pl-60">
      <SideNavServer />
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

  // Creadores: el interruptor "Recibo llamadas" y la llamada entrante, en
  // toda la web.
  if (!profile) return page;
  return (
    <CallAvailabilityProvider initialAvailable={profile.callsAvailable} canStream={profile.verified}>
      {page}
    </CallAvailabilityProvider>
  );
}
