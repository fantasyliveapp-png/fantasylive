import 'server-only';

import { createEmailOtp, TOKEN_TTL_MS } from '@/lib/auth-tokens';
import { appLink, formatEmailDate, sendNotice, sendTemplate } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { getRequestInfo } from '@/lib/request-info';

/** Correos de la cuenta que se mandan desde varios sitios. */

const nameOf = (u: { username: string | null; name: string | null }) => u.username ?? u.name ?? 'hola';

/**
 * Manda un codigo OTP nuevo para confirmar el email (01).
 * 'sent' | 'limit' (demasiados en la ultima hora) | 'failed'.
 */
export async function sendEmailOtp(userId: string, welcome: boolean): Promise<'sent' | 'limit' | 'failed'> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, username: true, name: true } });
  if (!user) return 'failed';
  const code = await createEmailOtp(userId);
  if (!code) return 'limit';
  const ok = await sendTemplate(
    '01-bienvenida-verificar-email',
    user.email,
    welcome ? `${code} es tu código de Fantasy Live` : `Tu código: ${code}`,
    {
      userName: nameOf(user),
      code,
      expiresInMinutes: Math.round(TOKEN_TTL_MS.EMAIL_VERIFY / 60_000),
      actionUrl: appLink('/verificar-email'),
    },
  );
  return ok ? 'sent' : 'failed';
}

/** 15: aviso de contraseña cambiada, con desde donde. */
export async function sendPasswordChanged(user: { email: string; username: string | null; name: string | null }) {
  const info = await getRequestInfo();
  return sendTemplate('15-contrasena-cambiada', user.email, 'Tu contraseña se ha cambiado', {
    userName: nameOf(user),
    changeDate: formatEmailDate(new Date(), true),
    device: info.device,
    location: info.location,
  });
}

/**
 * 16: si es la primera vez que entra desde este dispositivo (y no es su
 * primera sesion), le avisa. Siempre apunta el dispositivo.
 */
export async function recordLoginDevice(user: { id: string; email: string; username: string | null; name: string | null }) {
  try {
    const info = await getRequestInfo();
    const known = await prisma.userDevice.findUnique({
      where: { userId_deviceKey: { userId: user.id, deviceKey: info.deviceKey } },
      select: { id: true },
    });
    const hadDevices = known ? true : (await prisma.userDevice.count({ where: { userId: user.id } })) > 0;
    await prisma.userDevice.upsert({
      where: { userId_deviceKey: { userId: user.id, deviceKey: info.deviceKey } },
      create: { userId: user.id, deviceKey: info.deviceKey, label: info.device, lastIp: info.ip, lastCountry: info.country },
      update: { lastSeenAt: new Date(), lastIp: info.ip, lastCountry: info.country, label: info.device },
    });
    if (known || !hadDevices) return;
    await sendTemplate('16-nuevo-inicio-sesion', user.email, 'Nuevo inicio de sesión en tu cuenta', {
      userName: nameOf(user),
      device: info.device,
      browser: info.browser,
      location: info.location,
      ipAddress: info.ip ?? 'Desconocida',
      loginDate: formatEmailDate(new Date(), true),
    });
  } catch (error) {
    console.error('[login] no se pudo registrar el dispositivo', error);
  }
}

/** 17 al email nuevo + aviso al antiguo. */
export async function sendEmailChangeMails(
  user: { email: string; username: string | null; name: string | null },
  newEmail: string,
  token: string,
) {
  const ok = await sendTemplate('17-cambio-email', newEmail, 'Confirma tu nuevo correo', {
    userName: nameOf(user),
    oldEmail: user.email,
    newEmail,
    actionUrl: appLink(`/confirmar-email?token=${token}`),
    expiresInHours: Math.round(TOKEN_TTL_MS.EMAIL_CHANGE / 3_600_000),
  });
  await sendNotice(user.email, {
    subject: 'Se pidió cambiar el correo de tu cuenta',
    heading: 'Cambio de correo solicitado',
    paragraphs: [
      `Hola ${nameOf(user)}, alguien pidió cambiar el correo de tu cuenta a ${newEmail}.`,
      'El cambio solo se hace si se confirma desde ese correo nuevo. Hasta entonces sigues usando este.',
    ],
    action: { label: 'No fui yo: proteger mi cuenta', url: appLink('/forgot-password') },
    footnote: 'Si fuiste tú, no tienes que hacer nada.',
  });
  return ok;
}
