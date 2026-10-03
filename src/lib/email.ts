import 'server-only';

import nodemailer, { type Transporter } from 'nodemailer';

import { config } from '@/lib/config';

/**
 * CORREO SALIENTE
 *
 * Todo pasa por SMTP, asi que sirve cualquier servidor: el Postfix del propio
 * VPS o un proveedor. Cambiar de uno a otro es tocar SMTP_* en el .env.
 *
 * Sin SMTP configurado no se envia nada: el enlace se escribe en el registro
 * del servidor (asi se puede probar en local y un admin puede pasarlo a mano).
 *
 * Los correos nunca llevan contenido adulto: solo texto de cuenta.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.email.configured) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
      // El Postfix local usa un certificado propio: no se exige que sea publico.
      tls: { rejectUnauthorized: config.email.host !== 'localhost' && config.email.host !== '127.0.0.1' },
    });
  }
  return transporter;
}

export function emailEnabled() {
  return config.email.configured;
}

type Mail = {
  to: string;
  subject: string;
  /** Titulo grande dentro del correo. */
  heading: string;
  /** Parrafos de texto (sin HTML). */
  paragraphs: string[];
  /** Boton principal. */
  action?: { label: string; url: string };
  /** Nota pequeña al final ("Si no fuiste tu..."). */
  footnote?: string;
};

/** Envia un correo. Nunca lanza: devuelve false si no se pudo. */
export async function sendEmail(mail: Mail): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.info(
      `[email] (sin SMTP) Para ${mail.to}: ${mail.subject}${mail.action ? ` -> ${mail.action.url}` : ''}`,
    );
    return false;
  }
  try {
    await t.sendMail({
      from: config.email.from,
      to: mail.to,
      subject: mail.subject,
      text: renderText(mail),
      html: renderHtml(mail),
    });
    return true;
  } catch (error) {
    console.error('[email] no se pudo enviar', mail.subject, 'a', mail.to, error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Plantilla
// ---------------------------------------------------------------------------

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

function renderText(m: Mail) {
  return [
    m.heading,
    '',
    ...m.paragraphs.flatMap((p) => [p, '']),
    ...(m.action ? [`${m.action.label}: ${m.action.url}`, ''] : []),
    ...(m.footnote ? [m.footnote, ''] : []),
    `— ${config.app.name}`,
  ].join('\n');
}

function renderHtml(m: Mail) {
  const brand = '#e0283c';
  const paragraphs = m.paragraphs
    .map((p) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.55;color:#d6d6dc">${esc(p)}</p>`)
    .join('');
  const button = m.action
    ? `<p style="margin:24px 0"><a href="${esc(m.action.url)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:10px">${esc(m.action.label)}</a></p>
<p style="margin:0 0 14px;font-size:12px;line-height:1.5;color:#8b8b95">Si el botón no funciona, copia este enlace:<br><span style="word-break:break-all;color:#b9b9c2">${esc(m.action.url)}</span></p>`
    : '';
  const foot = m.footnote
    ? `<p style="margin:18px 0 0;font-size:12px;line-height:1.5;color:#8b8b95">${esc(m.footnote)}</p>`
    : '';
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(m.subject)}</title></head>
<body style="margin:0;background:#0b0b0f;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#0b0b0f;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px;background:#16161c;border-radius:16px;padding:28px">
<tr><td>
<p style="margin:0 0 22px;font-size:20px;font-weight:800;letter-spacing:.5px;color:#fff">${esc(config.app.name)}</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:#fff">${esc(m.heading)}</h1>
${paragraphs}${button}${foot}
</td></tr></table>
<p style="margin:16px 0 0;font-size:11px;color:#6b6b75">${esc(config.app.name)} · ${esc(config.app.url.replace(/^https?:\/\//, ''))} · Solo mayores de 18 años</p>
</td></tr></table></body></html>`;
}

// ---------------------------------------------------------------------------
// Correos de la web
// ---------------------------------------------------------------------------

export function appLink(path: string) {
  return `${config.app.url.replace(/\/$/, '')}${path}`;
}

export function sendVerifyEmail(to: string, name: string, url: string, welcome: boolean) {
  return sendEmail({
    to,
    subject: welcome ? `Bienvenido a ${config.app.name}: confirma tu email` : 'Confirma tu email',
    heading: welcome ? `¡Hola, ${name}!` : 'Confirma tu email',
    paragraphs: [
      ...(welcome ? [`Tu cuenta en ${config.app.name} ya está creada.`] : []),
      'Confirma que este email es tuyo. Lo necesitas para comprar tokens, hacerte creadora y retirar tus ganancias, y para poder recuperar tu cuenta si olvidas la contraseña.',
    ],
    action: { label: 'Confirmar mi email', url },
    footnote: 'El enlace caduca en 48 horas. Si no creaste esta cuenta, ignora este correo.',
  });
}

export function sendPasswordResetEmail(to: string, url: string) {
  return sendEmail({
    to,
    subject: 'Restablece tu contraseña',
    heading: 'Restablece tu contraseña',
    paragraphs: ['Alguien (seguramente tú) pidió cambiar la contraseña de tu cuenta.'],
    action: { label: 'Poner una contraseña nueva', url },
    footnote:
      'El enlace caduca en 1 hora y solo sirve una vez. Si no lo pediste tú, ignora este correo: tu contraseña no cambia.',
  });
}

export function sendPasswordChangedEmail(to: string) {
  return sendEmail({
    to,
    subject: 'Tu contraseña se ha cambiado',
    heading: 'Tu contraseña se ha cambiado',
    paragraphs: [
      'La contraseña de tu cuenta acaba de cambiar y se cerró la sesión en tus otros dispositivos.',
      'Si fuiste tú, no tienes que hacer nada.',
    ],
    action: { label: 'No fui yo: recuperar mi cuenta', url: appLink('/forgot-password') },
    footnote: 'Si no fuiste tú, recupera la cuenta enseguida y escríbenos desde Soporte.',
  });
}

/** Aviso de la cuenta (KYC, retiros...): texto corto y un enlace. */
export function sendAccountNotice(to: string, notice: { subject: string; heading: string; body: string[]; link?: { label: string; path: string } }) {
  return sendEmail({
    to,
    subject: notice.subject,
    heading: notice.heading,
    paragraphs: notice.body,
    action: notice.link ? { label: notice.link.label, url: appLink(notice.link.path) } : undefined,
  });
}
