import Link from 'next/link';

import { Logo } from '@/components/brand/logo';

const COLUMNS = [
  {
    title: 'Plataforma',
    links: [
      { href: '/models', label: 'Descubrir creadores' },
      { href: '/random', label: 'Llamadas aleatorias' },
      { href: '/vip', label: 'Sala VIP' },
      { href: '/wallet', label: 'Comprar tokens' },
    ],
  },
  {
    title: 'Para creadores',
    links: [
      { href: '/register?role=model', label: 'Trabaja con nosotros' },
      { href: '/dashboard/model', label: 'Panel de creador' },
      { href: '/dashboard/model/kyc', label: 'Verificacion KYC' },
      { href: '/dashboard/model/payouts', label: 'Retiros' },
    ],
  },
  {
    title: 'Legal',
    links: [
      { href: '/legal/terms', label: 'Terminos de servicio' },
      { href: '/legal/privacy', label: 'Privacidad' },
      { href: '/legal/2257', label: 'Cumplimiento 18 USC 2257' },
      { href: '/legal/dmca', label: 'DMCA' },
    ],
  },
];

export function Footer() {
  return (
    <footer className="border-t border-border/60 bg-card/30">
      <div className="container py-12">
        <div className="grid gap-10 md:grid-cols-4">
          <div>
            <Logo />
            <p className="mt-4 text-sm text-muted-foreground">
              Conoce gente nueva y a tus creadores de contenido favoritos, en
              un espacio privado y verificado.
            </p>
          </div>

          {COLUMNS.map((col) => (
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
            &copy; {new Date().getFullYear()} FantasyLive. Todos los derechos
            reservados.
          </p>
          <p>
            Sitio etiquetado RTA &middot; Solo mayores de 18 anos &middot;
            Cumplimiento 18 U.S.C. 2257
          </p>
        </div>
      </div>
    </footer>
  );
}
