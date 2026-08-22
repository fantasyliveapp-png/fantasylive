'use client';

import { signOut } from 'next-auth/react';
import { LogOut } from 'lucide-react';

import { Button } from '@/components/ui/button';

export function LogoutButton() {
  return (
    <Button variant="outline" onClick={() => signOut({ callbackUrl: '/' })}>
      <LogOut className="h-4 w-4" />
      Cerrar sesion
    </Button>
  );
}
