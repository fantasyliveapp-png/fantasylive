import { NextResponse } from 'next/server';

import { getCurrentUser } from '@/lib/auth/guards';
import { getUnreadChatCount } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** GET /api/messages/unread -> { count }: chats con mensajes sin leer. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ count: 0 });
  const count = await getUnreadChatCount(user.id, user.modelProfileId ?? null);
  return NextResponse.json({ count }, { headers: { 'Cache-Control': 'no-store' } });
}
