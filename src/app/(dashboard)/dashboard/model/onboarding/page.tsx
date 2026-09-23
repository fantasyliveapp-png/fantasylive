import { redirect } from 'next/navigation';

/** La activacion del modo creadora vive ahora en /hazte-creadora. */
export default function LegacyOnboardingPage() {
  redirect('/hazte-creadora');
}
