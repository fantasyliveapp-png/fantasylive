import { redirect } from 'next/navigation';

/** Bandeja antigua de fans: todos los chats viven ahora en /mensajes. */
export default function LegacyUserMessagesPage() {
  redirect('/mensajes');
}
