import { redirect } from 'next/navigation';

/** Tus pedidos a medida estan en el chat con cada creador. */
export default function UserRequestsPage() {
  redirect('/mensajes?filtro=pedidos');
}
