import { redirect } from 'next/navigation';

/** Los pedidos a medida se gestionan dentro del chat con cada fan. */
export default function ModelRequestsPage() {
  redirect('/mensajes?filtro=pedidos');
}
