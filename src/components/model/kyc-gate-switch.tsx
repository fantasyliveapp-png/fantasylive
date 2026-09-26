'use client';

import { usePathname } from 'next/navigation';

/** Paginas del panel que una creadora SIN verificar si puede abrir. */
const OPEN_WHILE_UNVERIFIED = ['/dashboard/model/kyc'];

/**
 * Mientras la creadora no esta verificada, cualquier pagina del panel
 * (salvo la de verificacion) muestra la pantalla de verificacion en su
 * lugar. Es solo la interfaz: las acciones del servidor lo comprueban
 * tambien (creator-kyc.ts), asi que no se puede saltar.
 */
export function KycGateSwitch({
  gate,
  children,
}: {
  gate: React.ReactNode;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const open = OPEN_WHILE_UNVERIFIED.some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
  return <>{open ? children : gate}</>;
}
