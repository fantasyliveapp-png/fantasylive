import { redirect } from 'next/navigation';

/** La activacion del modo creadora vive ahora en /hazte-creador. */
export default function LegacyOnboardingPage() {
  redirect('/hazte-creador');
}
