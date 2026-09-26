import { redirect } from 'next/navigation';

/** Direccion antigua del chat visto por la creadora: ahora /mensajes/<id>. */
export default async function OldCreatorChatPage({
  params,
}: {
  params: Promise<{ conversationId: string }>;
}) {
  const { conversationId } = await params;
  redirect(`/mensajes/${conversationId}`);
}
