import 'server-only';

import { readFileSync } from 'node:fs';
import path from 'node:path';

import nodemailer, { type Transporter } from 'nodemailer';

import { config } from '@/lib/config';

/**
 * CORREO SALIENTE
 *
 * Todo pasa por SMTP, asi que sirve cualquier servidor: el Stalwart del
 * propio VPS o un proveedor. Cambiar de uno a otro es tocar SMTP_* en el .env.
 *
 * Sin SMTP configurado no se envia nada: el asunto (y el enlace o codigo) se
 * escriben en el registro del servidor, asi se puede probar en local.
 *
 * Las plantillas estan en /emails (diseño de Fantasy Live): HTML con
 * variables {{nombre}} (se escapan) y {{{nombre}}} (HTML ya preparado aqui).
 * Las imagenes `assets/...` se sirven desde /public/email-assets.
 */

let transporter: Transporter | null = null;

function getTransporter(): Transporter | null {
  if (!config.email.configured) return null;
  if (!transporter) {
    const local = config.email.host === 'localhost' || config.email.host === '127.0.0.1';
    transporter = nodemailer.createTransport({
      host: config.email.host,
      port: config.email.port,
      secure: config.email.secure,
      auth: config.email.user ? { user: config.email.user, pass: config.email.pass } : undefined,
      // El servidor de correo local usa su propio certificado.
      tls: { rejectUnauthorized: !local },
    });
  }
  return transporter;
}

export function emailEnabled() {
  return config.email.configured;
}

export function appLink(p: string) {
  return `${config.app.url.replace(/\/$/, '')}${p}`;
}

// ---------------------------------------------------------------------------
// Plantillas
// ---------------------------------------------------------------------------

export type TemplateName =
  | '00-aviso'
  | '01-bienvenida-verificar-email'
  | '02-restablecer-contrasena'
  | '05-suscripcion-confirmada'
  | '09-suscripcion-cancelada'
  | '11-creador-solicitud-aprobada'
  | '12-creador-solicitud-rechazada'
  | '13-creador-pago-enviado'
  | '14-creador-resumen-semanal'
  | '15-contrasena-cambiada'
  | '16-nuevo-inicio-sesion'
  | '17-cambio-email';

const cache = new Map<string, string>();

function loadTemplate(name: TemplateName) {
  const cached = process.env.NODE_ENV === 'production' ? cache.get(name) : undefined;
  if (cached) return cached;
  const html = readFileSync(path.join(process.cwd(), 'emails', `${name}.html`), 'utf8');
  cache.set(name, html);
  return html;
}

const esc = (t: string) =>
  t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

type Vars = Record<string, string | number | null | undefined>;

function commonVars(): Vars {
  return {
    appUrl: config.app.url.replace(/\/$/, ''),
    year: new Date().getFullYear(),
    companyAddress: process.env.COMPANY_ADDRESS || config.app.url.replace(/^https?:\/\//, ''),
    preferencesUrl: appLink('/dashboard/settings'),
    supportUrl: appLink('/soporte'),
    securityUrl: appLink('/forgot-password'),
    settingsUrl: appLink('/dashboard/settings'),
  };
}

export function renderTemplate(name: TemplateName, vars: Vars) {
  const all = { ...commonVars(), ...vars };
  const value = (key: string) => {
    const v = all[key];
    return v == null ? '' : String(v);
  };
  return loadTemplate(name)
    .replace(/\{\{\{\s*(\w+)\s*\}\}\}/g, (_, k: string) => value(k))
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (_, k: string) => esc(value(k)))
    .replace(/(src="|url\(')assets\//g, `$1${appLink('/email-assets/')}`);
}

/** Version en texto plano (para clientes sin HTML y para el filtro antispam). */
function toText(html: string) {
  const body = html.slice(html.indexOf('<body'));
  return body
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g, (_, href: string, label: string) => `${label.replace(/<[^>]+>/g, '').trim()} (${href})`)
    .replace(/<(br|\/p|\/h1|\/tr|\/li)[^>]*>/g, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;|&#8202;|&#847;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean)
    .join('\n');
}

/** Envia una plantilla. Nunca lanza: devuelve false si no se pudo. */
export async function sendTemplate(name: TemplateName, to: string, subject: string, vars: Vars): Promise<boolean> {
  let html: string;
  try {
    html = renderTemplate(name, vars);
  } catch (error) {
    console.error('[email] no se pudo preparar la plantilla', name, error);
    return false;
  }
  const t = getTransporter();
  if (!t) {
    const hint = vars.code ? ` (codigo ${vars.code})` : vars.actionUrl ? ` -> ${vars.actionUrl}` : '';
    console.info(`[email] (sin SMTP) Para ${to}: ${subject}${hint}`);
    return false;
  }
  try {
    await t.sendMail({ from: config.email.from, to, subject, html, text: toText(html) });
    return true;
  } catch (error) {
    console.error('[email] no se pudo enviar', subject, 'a', to, error);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Ayudas de formato
// ---------------------------------------------------------------------------

export function formatEmailDate(d: Date, withTime = false) {
  const date = d.toLocaleDateString('es', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (!withTime) return date;
  const time = d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' });
  return `${date}, ${time} (UTC)`;
}

export function formatUsd(cents: number) {
  return `${(cents / 100).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} US$`;
}

// ---------------------------------------------------------------------------
// Aviso generico (00-aviso): para lo que no tiene plantilla propia
// ---------------------------------------------------------------------------

const P_STYLE =
  'margin:0 0 16px; font-family:Arial, Helvetica, sans-serif; font-size:16px; line-height:26px; mso-line-height-rule:exactly; color:#F5F1EC;';

function buttonHtml(label: string, url: string) {
  const u = esc(url);
  const l = esc(label);
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="12" style="height:12px; font-size:0; line-height:0;">&nbsp;</td></tr><tr><td align="center"><table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;"><tr><td align="center" bgcolor="#C0273C" style="background:#C0273C; border-radius:6px;"><a href="${u}" style="display:block; padding:16px 40px; font-family:Arial, Helvetica, sans-serif; font-size:16px; font-weight:bold; color:#F5F1EC; text-decoration:none; letter-spacing:1px; text-transform:uppercase;">${l}</a></td></tr></table></td></tr><tr><td height="28" style="height:28px; font-size:0; line-height:0;">&nbsp;</td></tr></table>`;
}

export function sendNotice(
  to: string,
  n: { subject: string; heading: string; paragraphs: string[]; action?: { label: string; url: string }; footnote?: string },
) {
  return sendTemplate('00-aviso', to, n.subject, {
    subject: n.subject,
    preheader: n.paragraphs[0] ?? n.heading,
    heading: n.heading,
    bodyHtml: n.paragraphs.map((p) => `<p style="${P_STYLE}">${esc(p)}</p>`).join('\n'),
    buttonHtml: n.action ? buttonHtml(n.action.label, n.action.url) : '',
    footnote: n.footnote ?? '',
  });
}
