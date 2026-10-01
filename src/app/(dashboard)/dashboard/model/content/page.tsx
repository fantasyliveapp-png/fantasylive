import { redirect } from 'next/navigation';

/** Los packs antiguos se convirtieron en publicaciones: todo esta en Contenido. */
export default function LegacyContentPage() {
  redirect('/dashboard/model/contenido');
}
