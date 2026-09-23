import { UserMenu } from '@/components/layout/user-menu';
import { getCurrentUser } from '@/lib/auth/guards';
import { getOwnUsername, getProfileShortcut } from '@/lib/profile-shortcut';

/**
 * Menu de tu cuenta (Mi panel, Monedero, Ajustes, Cerrar sesion...) con un
 * boton de menu, para ponerlo en TU perfil en el movil: alli la barra de
 * arriba ya no lleva tu foto (esta abajo, en Perfil), como en Instagram.
 */
export async function OwnAccountMenu() {
  const user = await getCurrentUser();
  if (!user) return null;
  const [profile, username] = await Promise.all([
    getProfileShortcut(user.modelProfileId),
    getOwnUsername(user.id),
  ]);
  return (
    <UserMenu
      trigger="menu"
      name={profile?.stageName ?? user.name ?? user.email}
      email={user.email}
      image={profile?.avatarUrl ?? user.image ?? null}
      role={user.role}
      isVip={user.isVip}
      profileSlug={profile?.slug}
      username={username}
    />
  );
}
