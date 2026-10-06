# Plantillas de email — Fantasy Live

HTML listo para enviar (tablas + estilos inline, compatible con Gmail, Outlook y Apple Mail). Las variables usan sintaxis **Handlebars** `{{variable}}`.

## Plantillas
| Archivo | Disparador | Variables propias |
|---|---|---|
| 01-bienvenida-verificar-email | Registro | userName, actionUrl, expiresInHours |
| 02-restablecer-contrasena | "Olvidé mi contraseña" | userName, actionUrl, expiresInMinutes, requestDevice, requestLocation, requestDate, securityUrl |
| 03-verificacion-edad-aprobada | Verificación OK | userName, actionUrl |
| 04-verificacion-edad-rechazada | Verificación rechazada | userName, rejectionReason, actionUrl |
| 05-suscripcion-confirmada | Webhook Stripe `invoice.paid` | userName, creatorName, planName, amount, nextBillingDate, paymentMethod, receiptNumber, billingUrl, billingDescriptor, actionUrl |
| 06-pago-fallido | Webhook Stripe `invoice.payment_failed` | userName, creatorName, amount, paymentMethod, graceEndDate, actionUrl |
| 07-propina-recibida-creador | Propina recibida | creatorName, tipperName, amount, tipMessage, streamTitle, balance, actionUrl |
| 08-creador-en-vivo | Inicio de stream (seguidores) | creatorName, streamTitle, streamThumbnailUrl, actionUrl, unsubscribeUrl |
| 09-suscripcion-cancelada | Usuario cancela | userName, creatorName, planName, accessEndDate, cancelDate, actionUrl |
| 10-renovacion-proxima | 3–7 días antes del cobro (cron) | userName, creatorName, daysLeft, renewalDate, amount, paymentMethod, billingUrl |
| 11-creador-solicitud-aprobada | Admin aprueba creador | creatorName, actionUrl, guidelinesUrl |
| 12-creador-solicitud-rechazada | Admin rechaza creador | userName, rejectionReason, reapplyDate, actionUrl |
| 13-creador-pago-enviado | Webhook Stripe `payout.paid` | creatorName, amount, periodStart, periodEnd, payoutDestination, payoutId, payoutDate, arrivalDays, feePercent, actionUrl |
| 14-creador-resumen-semanal | Cron semanal (lunes) | creatorName, weekStart, weekEnd, weekEarnings, newSubscribers, liveHours, subscriptionEarnings, tipEarnings, peakViewers, activeSubscribers, cancellations, actionUrl |
| 15-contrasena-cambiada | Tras cambiar contraseña | userName, changeDate, device, location, securityUrl |
| 16-nuevo-inicio-sesion | Login desde dispositivo nuevo | userName, device, browser, location, ipAddress, loginDate, securityUrl, settingsUrl |
| 17-cambio-email | Solicitud de cambio (enviar al correo NUEVO) | userName, oldEmail, newEmail, actionUrl, expiresInHours, securityUrl |

**Variables comunes:** `appUrl`, `year`, `companyAddress`, `preferencesUrl`, `supportUrl`.

## Logo y fuente
- **Logo + nombre en Akira:** `assets/header-fantasy-live.png` (imagen, se ve en todos los clientes).
- **Títulos en Bebas Neue:** `assets/BebasNeue-Regular.ttf` vía @font-face. Se ve en Apple Mail, iOS Mail, Outlook.com/app de Mac y Thunderbird. **Gmail y Outlook de Windows no permiten fuentes propias** y muestran Arial Black (ya ajustado).
- Las plantillas usan rutas relativas `assets/...` para que se vean al abrirlas en el navegador. El mailer las convierte a URL absoluta antes de enviar (ver abajo).

Sirve la carpeta con Express:
```js
app.use('/email-assets', express.static('emails/assets'));
```
> En producción `PUBLIC_URL` debe ser un dominio https accesible desde internet.

## Montaje en Node/Express

```bash
npm i nodemailer handlebars
```

```js
// server/services/mailer.js
import fs from 'node:fs/promises';
import path from 'node:path';
import Handlebars from 'handlebars';
import nodemailer from 'nodemailer';

const dir = path.resolve('emails');
const cache = new Map();

const transport = nodemailer.createTransport({
  host: process.env.SMTP_HOST,      // local: 'localhost' con MailHog/Mailpit
  port: Number(process.env.SMTP_PORT || 1025),
  secure: false,
  auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
});

const common = () => ({
  year: new Date().getFullYear(),
  companyAddress: process.env.COMPANY_ADDRESS,
  preferencesUrl: `${process.env.APP_URL}/configuracion/notificaciones`,
  supportUrl: `${process.env.APP_URL}/soporte`,
  appUrl: process.env.APP_URL,
});

async function render(name, data) {
  if (!cache.has(name)) cache.set(name, Handlebars.compile(await fs.readFile(path.join(dir, `${name}.html`), 'utf8')));
  const html = cache.get(name)({ ...common(), ...data });
  // rutas relativas -> absolutas para el cliente de correo
  return html.replace(/(src="|url\(')assets\//g, `$1${process.env.PUBLIC_URL}/email-assets/`);
}

export async function sendMail(name, to, subject, data) {
  const html = await render(name, data);
  return transport.sendMail({ from: '"Fantasy Live" <no-reply@fantazylive.com>', to, subject, html });
}
```

```js
await sendMail('01-bienvenida-verificar-email', user.email, 'Confirma tu correo', {
  userName: user.displayName,
  actionUrl: `${process.env.APP_URL}/verificar?token=${token}`,
  expiresInHours: 24,
});
```

> Para el cambio de email, envía también un aviso al correo **anterior** reutilizando `15-contrasena-cambiada` como modelo, o el 17 con `actionUrl` apuntando a `securityUrl`.

## Probar en local
Usa **Mailpit** (`docker run -p 8025:8025 -p 1025:1025 axllent/mailpit`) → SMTP en `localhost:1025`, bandeja en `http://localhost:8025`.

## Notas
- Handlebars escapa HTML por defecto (bien para `tipMessage`, que es texto de usuario).
- `streamThumbnailUrl` debe ser una URL https pública.
