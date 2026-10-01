import { redirect } from 'next/navigation';

/** Los pedidos y citas viven ahora dentro de cada chat, en Mensajes. */
export default async function InboxPage({
  searchParams,
}: {
  searchParams: Promise<{ tipo?: string }>;
}) {
  const { tipo } = await searchParams;
  redirect(tipo === 'citas' ? '/mensajes?filtro=reservas' : '/mensajes?filtro=pedidos');
}
