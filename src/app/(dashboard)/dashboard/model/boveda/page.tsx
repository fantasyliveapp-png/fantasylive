import { redirect } from 'next/navigation';

/** La Boveda vive ahora en Contenido → Privado → Para chat. */
export default function VaultPage() {
  redirect('/dashboard/model/contenido?tab=chat');
}
