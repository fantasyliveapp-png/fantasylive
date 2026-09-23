import { redirect } from 'next/navigation';

/** Lista antigua de chats de la creadora: todos viven ahora en /mensajes. */
export default function LegacyModelMessagesPage() {
  redirect('/mensajes');
}
