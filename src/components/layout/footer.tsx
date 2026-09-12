import Link from 'next/link';

import { Logo } from '@/components/brand/logo';
import { getT } from '@/lib/i18n/server';

export async function Footer() {
  const t = await getT();

  // Las columnas se construyen dentro del componente, no en un const de
  // modulo: los textos dependen del idioma resuelto en cada peticion.
  const columns = [
    {
      title: t('footer.platform'),
      links: [
        { href: '/feed', label: t('feed.discover') },
        { href: '/live', label: t('live.title') },
        { href: '/models', label: t('footer.discoverCreators') },
        { href: '/random', label: t('footer.randomCalls') },
        { href: '/vip', label: t('nav.vip') },
        { href: '/wallet', label: t('common.buyTokens') },
      ],
    },
    {
      title: t('footer.forCreators'),
      links: [
        { href: '/register?role=model', label: t('footer.workWithUs') },
        { href: '/dashboard/model', label: t('footer.creatorDashboard') },
        { href: '/dashboard/model/live', label: t('live.startStream') },
        { href: '/dashboard/model/kyc', label: t('footer.kyc') },
        { href: '/dashboard/model/payouts', label: t('footer.payouts') },
      ],
    },
    {
      title: t('footer.legal'),
      links: [
        { href: '/legal/terms', label: t('footer.terms') },
        { href: '/legal/privacy', label: t('footer.privacy') },
        { href: '/legal/2257', label: t('footer.compliance2257') },
        { href: '/legal/dmca', label: 'DMCA' },
      ],
    },
  ];

  return (
    <footer className="border-t border-border/60 bg-card/30">
      <div className="container py-12">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-4 text-sm text-muted-foreground">
              {t('footer.tagline')}
            </p>
          </div>

          {columns.map((col) => (
            <div key={col.title}>
              <h4 className="text-sm font-semibold">{col.title}</h4>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.href}>
                    <Link
                      href={link.href}
                      className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                    >
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <div className="mt-10 flex flex-col items-center justify-between gap-4 border-t border-border/60 pt-6 text-xs text-muted-foreground sm:flex-row">
          <p>
            &copy; {new Date().getFullYear()} FantasyLive. {t('footer.rights')}
          </p>
          <p>{t('footer.ratingNotice')}</p>
        </div>
      </div>
    </footer>
  );
}
