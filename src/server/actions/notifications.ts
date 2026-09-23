'use server';

import { revalidatePath } from 'next/cache';

import { getAuthedUserOrThrow } from '@/lib/auth/guards';
import { prisma } from '@/lib/prisma';

export interface NotificationActionResult {
  ok: boolean;
  error?: string;
}

export async function markNotificationReadAction(
  notificationId: string,
): Promise<NotificationActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await prisma.notification.updateMany({
      where: { id: notificationId, userId: user.id },
      data: { isRead: true },
    });
    revalidatePath('/');
    return { ok: true };
  } catch {
    return { ok: false, error: 'No se pudo actualizar.' };
  }
}

export async function markAllNotificationsReadAction(): Promise<NotificationActionResult> {
  try {
    const user = await getAuthedUserOrThrow();
    await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true },
    });
    revalidatePath('/');
    return { ok: true };
  } catch {
    return { ok: false, error: 'No se pudo actualizar.' };
  }
}
