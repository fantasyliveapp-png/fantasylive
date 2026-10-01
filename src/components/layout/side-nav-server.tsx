import { SideNav } from '@/components/layout/side-nav';
import { getCurrentUser } from '@/lib/auth/guards';
import { getOwnUsername, getProfileShortcut, isDistributorAccount, isRecruiterAccount } from '@/lib/profile-shortcut';
import { getWalletSummary } from '@/lib/tokens';

/** Barra lateral de escritorio con los datos de la cuenta en sesion. */
export async function SideNavServer() {
  const user = await getCurrentUser();
  if (!user) return <SideNav account={null} />;
  const [profile, username, wallet, recruiter, distributor] = await Promise.all([
    getProfileShortcut(user.modelProfileId),
    getOwnUsername(user.id),
    getWalletSummary(user.id),
    isRecruiterAccount(user.id),
    isDistributorAccount(user.id),
  ]);
  return (
    <SideNav
      account={{
        name: profile?.stageName ?? user.name ?? user.email,
        email: user.email,
        image: profile?.avatarUrl ?? user.image ?? null,
        role: user.role,
        isVip: user.isVip,
        profileSlug: profile?.slug ?? null,
        username,
        verified: profile?.verified ?? true,
        balance: wallet.balance,
        isRecruiter: recruiter,
        isDistributor: distributor,
      }}
    />
  );
}
