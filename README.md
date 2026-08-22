# FantasyLive

Plataforma web para adultos (18+) de interacción en vivo: videollamadas aleatorias estilo Omegle, sala VIP con cobro por minuto, catálogo de modelos multi-género, contenido exclusivo desbloqueable y reservas privadas — todo sobre un monedero único de tokens.

> **Aviso:** este proyecto es un scaffold funcional completo, listo para pruebas locales y despliegue. Antes de operar comercialmente debes revisar con un profesional jurídico los documentos legales (`/legal/*`), contratar una pasarela que admita contenido adulto (Stripe restringe este vertical; CCBill/Segpay/Epoch son las habituales) y completar el proceso de verificación de edad exigido en tu jurisdicción.

---

## Índice

1. [Stack](#stack)
2. [Arranque rápido (5 minutos)](#arranque-rápido-5-minutos)
3. [Credenciales de prueba](#credenciales-de-prueba)
4. [Qué probar en local](#qué-probar-en-local)
5. [Estructura del proyecto](#estructura-del-proyecto)
6. [Modelo de datos](#modelo-de-datos)
7. [Cómo funciona cada módulo](#cómo-funciona-cada-módulo)
8. [Servicios externos (opcionales)](#servicios-externos-opcionales)
9. [Subir a GitHub](#subir-a-github)
10. [Desplegar en Vercel](#desplegar-en-vercel)
11. [Scripts disponibles](#scripts-disponibles)
12. [Estado de verificación](#estado-de-verificación)

---

## Stack

| Capa | Tecnología |
|---|---|
| Framework | Next.js 15 (App Router, React Server Components, Server Actions) |
| Lenguaje | TypeScript (modo estricto) |
| UI | Tailwind CSS + Radix UI (primitivas shadcn escritas en el repo) |
| Base de datos | PostgreSQL 16 + Prisma ORM 6 |
| Autenticación | NextAuth / Auth.js v5 (JWT, multi-rol: `USER`, `MODEL`, `ADMIN`) |
| Vídeo | LiveKit (SFU) con modo demo sin configuración |
| Señalización | Server-Sent Events sobre API Routes (compatible con Vercel serverless) |
| Almacenamiento | S3 / Cloudflare R2 / MinIO con URLs firmadas privadas |
| Pagos | Stripe, CCBill o proveedor `mock` para desarrollo |
| Despliegue | Vercel |

---

## Arranque rápido (5 minutos)

### Requisitos

- **Node.js 20+** (probado con 24.13)
- **Docker Desktop** — para la base de datos local
  *(¿sin Docker? Ver [alternativa sin Docker](#alternativa-sin-docker))*

### Pasos

```bash
# 1. Instalar dependencias
npm install

# 2. Crear el archivo de entorno
cp .env.example .env          # Windows PowerShell: Copy-Item .env.example .env

# 3. Levantar PostgreSQL (+ MinIO + Adminer)
npm run db:up

# 4. Crear las tablas
npm run db:migrate

# 5. Poblar con datos de prueba
npm run db:seed

# 6. Arrancar
npm run dev
```

Abre **http://localhost:3000**.

O todo de una vez:

```bash
npm run setup:local
```

Comprueba que todo está conectado en **http://localhost:3000/api/health**.

### Servicios que levanta `npm run db:up`

| Servicio | URL | Credenciales |
|---|---|---|
| PostgreSQL | `localhost:5432` | `fantasy` / `fantasy` |
| Adminer (GUI de BD) | http://localhost:8080 | servidor `postgres`, usuario `fantasy` |
| MinIO (S3 local) | http://localhost:9001 | `fantasy` / `fantasy123` |

El bucket `fantasylive-content` se crea automáticamente.

### Alternativa sin Docker

Usa una base de datos gestionada gratuita ([Neon](https://neon.tech) o [Supabase](https://supabase.com)), pega su cadena de conexión en `DATABASE_URL` dentro de `.env` y salta el paso 3:

```env
DATABASE_URL="postgresql://user:pass@host/db?sslmode=require"
```

Sin MinIO, la subida de archivos queda desactivada (la interfaz lo indica); todo lo demás funciona porque el seed usa imágenes remotas de placeholder.

---

## Credenciales de prueba

**Contraseña para todas las cuentas: `Password123!`**

| Rol | Email | Para probar |
|---|---|---|
| Admin | `admin@fantasylive.test` | Panel completo, KYC, payouts, reportes |
| Usuario | `usuario@fantasylive.test` | 1250 tokens, VIP — flujo completo de compra |
| Usuario | `laura@fantasylive.test` | 90 tokens — saldo bajo, corte por falta de tokens |
| Usuario | `tom@fantasylive.test` | 0 tokens — paywall y bloqueo de acceso VIP |
| Modelo | `valentina@fantasylive.test` | Elite, online, KYC aprobado, contenido de pago |
| Modelo | `mateo@fantasylive.test` | Gay, VIP, online |
| Modelo | `nina@fantasylive.test` | Trans femenina, VIP |
| Modelo | `kai@fantasylive.test` | No binario, online |
| Modelo | `adrian@fantasylive.test` | KYC **pendiente** — para aprobar desde admin |
| Modelo | `thiago@fantasylive.test` | KYC **rechazado** |
| Modelo | `erik@fantasylive.test` | KYC **sin enviar** |

En desarrollo, la pantalla de login muestra botones para rellenar estas cuentas con un clic.

### Qué contiene el seed

23 usuarios · 12 modelos (6 géneros, 6 orientaciones) · 5 paquetes de tokens · 40 paquetes de contenido con 231 archivos · 45 llamadas históricas con 540 ticks de facturación · 112 transacciones · 10 reservas en 6 estados · 11 verificaciones KYC · 9 solicitudes de retiro · 6 reportes · 54 franjas horarias · 47 reseñas.

---

## Qué probar en local

### Flujo de usuario

1. Entra como `usuario@fantasylive.test`.
2. **Monedero** (`/wallet`) → compra un paquete. Con `PAYMENT_PROVIDER=mock` los tokens se acreditan al instante, sin cobro real.
3. **Catálogo** (`/models`) → filtra por género, orientación o etiqueta; ordena por precio o valoración.
4. Abre un perfil → pestaña **Contenido** → desbloquea un pack de pago. Los tokens se descuentan, la comisión se reparte y el pack queda desbloqueado para siempre.
5. **Reservar privado** → elige día, hora y duración. Los tokens quedan retenidos (`BOOKING_HOLD`).
6. **Llamada aleatoria** (`/random`) → entra en la cola. Abre una **segunda ventana en modo incógnito** con otra cuenta y entra también: el emparejamiento se produce y ambos entran en la sala.
7. **Sala VIP** (`/vip`) → cobro por minuto con temporizador en tiempo real; con `tom@` (0 tokens) el acceso se bloquea antes de entrar.

### Flujo de modelo

1. Entra como `valentina@fantasylive.test` → `/dashboard/model`.
2. Conmuta **En línea** y **Cola VIP** en la barra lateral (bloqueado si el KYC no está aprobado).
3. **Tarifas** → cambia el precio por minuto; se ve el equivalente estimado en dólares.
4. **Contenido** → crea un paquete y sube archivos (requiere MinIO/S3).
5. **Reservas** → confirma una solicitud pendiente y, tras la sesión, liquida los tokens retenidos.
6. **Retiros** → solicita un pago (mínimo 500 tokens, exige KYC aprobado).
7. Entra como `erik@fantasylive.test` → `/dashboard/model/kyc` para ver el formulario de verificación desde cero.

### Flujo de administrador

1. Entra como `admin@fantasylive.test` → `/admin`.
2. **KYC** → aprueba a `AdrianNight`; comprueba que su perfil pasa a aceptar reservas.
3. **Reportes** → resuelve una disputa reembolsando tokens al denunciante.
4. **Usuarios** → suspende, banea, promueve a VIP o ajusta el saldo manualmente (todo queda en el log de auditoría).
5. **Retiros** → aprueba o rechaza; el rechazo devuelve los tokens automáticamente.
6. **Transacciones** → libro mayor completo filtrable por tipo.

### Probar las videollamadas

Sin credenciales de LiveKit la app entra en **modo demo**: pide la cámara real y muestra tu propio vídeo, de modo que el temporizador, el contador de tokens, los regalos, el botón "siguiente" y el corte por saldo insuficiente son totalmente probables sin infraestructura.

Para vídeo bidireccional real, crea un proyecto gratuito en [LiveKit Cloud](https://cloud.livekit.io) y rellena en `.env`:

```env
LIVEKIT_API_KEY="APIxxxx"
LIVEKIT_API_SECRET="xxxx"
LIVEKIT_URL="wss://tu-proyecto.livekit.cloud"
NEXT_PUBLIC_LIVEKIT_URL="wss://tu-proyecto.livekit.cloud"
```

---

## Estructura del proyecto

```
FantasyLive/
├── docker-compose.yml           # Postgres + Adminer + MinIO en un comando
├── vercel.json                  # Regiones, duración de funciones, cabeceras de seguridad
├── .env.example                 # Todas las variables documentadas
├── prisma/
│   ├── schema.prisma            # 25 modelos, 19 enums
│   ├── migrations/              # Migración inicial generada
│   └── seed.ts                  # Datos ficticios completos
├── scripts/
│   ├── wait-for-db.mjs          # Espera a Postgres en setup:local
│   ├── init-git.ps1             # Publicar en GitHub (Windows)
│   └── init-git.sh              # Publicar en GitHub (Linux/macOS)
└── src/
    ├── middleware.ts            # Protección de rutas por rol en Edge
    ├── app/
    │   ├── (auth)/              # login · register · forgot-password
    │   ├── (main)/              # home · models · random · vip · wallet · bookings · legal
    │   ├── (dashboard)/
    │   │   ├── dashboard/       # panel de usuario · settings
    │   │   ├── dashboard/model/ # resumen · tarifas · contenido · reservas · ganancias · retiros · kyc
    │   │   └── admin/           # métricas · kyc · usuarios · reportes · retiros · transacciones
    │   ├── call/[sessionId]/    # sala de videollamada a pantalla completa
    │   └── api/
    │       ├── auth/[...nextauth]/
    │       ├── matchmaking/stream/     # SSE de la cola de emparejamiento
    │       ├── calls/[sessionId]/      # billing · state
    │       ├── content/[packageId]/    # URLs firmadas de contenido desbloqueado
    │       ├── webhooks/stripe/
    │       └── health/
    ├── components/
    │   ├── ui/                  # primitivas shadcn (button, card, dialog, table...)
    │   ├── calls/               # sala WebRTC, lobby, regalos, reportes
    │   ├── models/              # tarjeta y filtros de catálogo
    │   ├── content/             # galería con desbloqueo
    │   ├── bookings/            # calendario y acciones de reserva
    │   ├── model/               # formularios del panel de modelo
    │   ├── admin/               # tablas de revisión y moderación
    │   └── layout/              # navbar, footer, sidebar
    ├── hooks/
    │   ├── use-video-room.ts    # ciclo de vida de LiveKit + modo demo
    │   └── use-call-billing.ts  # temporizador y ticks de cobro
    ├── lib/
    │   ├── prisma.ts · config.ts · constants.ts · utils.ts
    │   ├── auth/                # auth.config (Edge) · index (Node) · guards
    │   ├── tokens.ts            # libro mayor atómico y comisiones
    │   ├── matchmaking.ts       # cola y emparejamiento
    │   ├── calls.ts             # facturación por minuto y cierre de llamada
    │   ├── livekit.ts · storage.ts · payments.ts
    └── server/actions/          # auth · wallet · calls · bookings · model · admin · onboarding
```

---

## Modelo de datos

25 modelos Prisma. Los principales:

| Modelo | Función |
|---|---|
| `User` | Cuenta con rol, estado, edad verificada, género y orientación |
| `Wallet` | Saldo, tokens retenidos, ganancias pendientes y contadores históricos |
| `TokenPackage` | Paquetes de compra con bonus y precio en centavos |
| `Transaction` | Libro mayor con signo, saldo posterior y comisión por movimiento |
| `ModelProfile` | Perfil público, tarifas, disponibilidad y métricas denormalizadas |
| `ContentPackage` / `ContentAsset` / `ContentUnlock` | Contenido de pago con claves S3 privadas |
| `CallSession` / `CallBillingTick` | Llamadas y auditoría de cada cobro por minuto |
| `MatchQueueEntry` / `BlockedPair` | Cola de emparejamiento y cooldown de "siguiente" |
| `Booking` / `AvailabilitySlot` | Reservas y agenda semanal |
| `KycVerification` | Documentación, revisor y caducidad anual |
| `PayoutRequest` | Retiros con método, destino y estado |
| `Report` / `AuditLog` | Moderación y trazabilidad administrativa |

---

## Cómo funciona cada módulo

### Economía de tokens

Todo movimiento pasa por `applyLedgerEntry()` (`src/lib/tokens.ts`), que se ejecuta **siempre dentro de una transacción de base de datos**. Los débitos usan un `UPDATE ... WHERE balance >= importe` condicional: si dos llamadas concurrentes intentan gastar el mismo saldo, una falla con `InsufficientTokensError` en lugar de dejar el monedero en negativo. Cada asiento guarda el saldo resultante como snapshot de auditoría.

El reparto usuario → modelo (`transferWithCommission`) descuenta, aplica `PLATFORM_COMMISSION_PERCENT` y acredita el neto al creador en la misma transacción.

### Cobro por minuto

El cliente envía un tick a `POST /api/calls/:id/billing` cada `CALL_BILLING_INTERVAL_SECONDS`, **pero el importe lo calcula el servidor** a partir de sus propios `startedAt` / `lastBilledAt`. Acelerar o falsear las peticiones desde el navegador no cambia lo que se cobra. Cuando el saldo no cubre el siguiente intervalo, el servidor cierra la sesión con `INSUFFICIENT_TOKENS` y expulsa de la sala.

### Matchmaking

`joinQueue()` inserta la entrada y busca de inmediato un candidato compatible (modo, filtro recíproco de género, exclusión de bloqueos y skips recientes). La reserva del compañero es un `UPDATE ... WHERE status = 'WAITING'` condicional: solo un emparejador gana, y si se pierde la carrera se libera al otro. Las entradas sin heartbeat durante 30 s se marcan como expiradas.

El estado llega al cliente por **SSE** (`/api/matchmaking/stream`), con polling de respaldo cada 3 s. Se eligió SSE en vez de WebSockets porque las funciones serverless de Vercel no mantienen conexiones bidireccionales persistentes; el bucle SSE hace además de heartbeat de la cola.

### Contenido privado

Las claves de S3 nunca llegan al navegador. `GET /api/content/:id/assets` comprueba el desbloqueo en base de datos y solo entonces devuelve URLs firmadas con caducidad (`SIGNED_URL_TTL_MINUTES`). Sin desbloqueo únicamente se sirven los teasers marcados como preview, y la miniatura se muestra difuminada por CSS.

### Reservas

Al reservar se **retienen** los tokens (`BOOKING_HOLD`). La cancelación por parte de la modelo devuelve el 100%; la del usuario con menos de 2 h de antelación penaliza el 50%. La sala se abre 10 minutos antes y se cierra 15 minutos después del final previsto. Al liquidar, el importe retenido se libera a la modelo menos comisión.

### Roles y protección

`src/middleware.ts` corre en Edge Runtime con una instancia de Auth.js **sin adaptador Prisma** (por eso la configuración está partida en `auth.config.ts` / `index.ts`). Redirige a `/login` conservando el destino, bloquea `/admin` a no administradores y expulsa a las cuentas baneadas a `/banned`. Cada Server Action revalida el rol por su cuenta: el middleware es la primera barrera, no la única.

---

## Servicios externos (opcionales)

Todos son opcionales: la app arranca y es navegable sin ninguno.

| Servicio | Sin configurar | Cómo activarlo |
|---|---|---|
| **LiveKit** | Llamadas en modo demo (cámara local) | Proyecto gratuito en [cloud.livekit.io](https://cloud.livekit.io) → `LIVEKIT_*` |
| **S3 / R2** | Subida desactivada; el seed usa placeholders remotos | MinIO local ya incluido, o [Cloudflare R2](https://developers.cloudflare.com/r2/) → `S3_*` |
| **Stripe** | `PAYMENT_PROVIDER=mock` acredita tokens al instante | `STRIPE_SECRET_KEY` + webhook a `/api/webhooks/stripe` |
| **CCBill** | — | `CCBILL_*` (recomendado para el vertical adulto) |
| **Google OAuth** | Solo login por email y contraseña | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` |

---

## Subir a GitHub

**Antes de nada:** `.env` está en `.gitignore`. Nunca lo subas — contiene secretos.

### Automático

```powershell
# Windows
.\scripts\init-git.ps1 -RepoName fantasylive -Private
```

```bash
# Linux / macOS / Git Bash
chmod +x scripts/init-git.sh
./scripts/init-git.sh fantasylive private
```

El script comprueba que `.env` esté realmente ignorado antes de hacer nada, crea el commit inicial y publica el repositorio con GitHub CLI.

### Manual

```bash
git init
git branch -M main
git add .
git status                     # verifica que .env NO aparece
git commit -m "chore: scaffold inicial de FantasyLive"
git remote add origin https://github.com/TU_USUARIO/fantasylive.git
git push -u origin main
```

---

## Desplegar en Vercel

### 1. Base de datos de producción

Vercel no aloja PostgreSQL, así que necesitas una gestionada. [Neon](https://neon.tech) tiene plan gratuito y es la opción más directa. En serverless hay que usar el pooler:

```env
DATABASE_URL="postgresql://user:pass@host-pooler.neon.tech/db?sslmode=require&pgbouncer=true&connection_limit=1"
DIRECT_URL="postgresql://user:pass@host.neon.tech/db?sslmode=require"
```

`DIRECT_URL` es obligatoria: Prisma la usa para las migraciones, que no funcionan a través del pooler.

### 2. Importar el proyecto

En [vercel.com/new](https://vercel.com/new), importa el repositorio. Vercel detecta Next.js automáticamente; `vercel.json` ya define el `buildCommand` que aplica las migraciones antes de compilar.

### 3. Variables de entorno

En **Settings → Environment Variables**, como mínimo:

```env
DATABASE_URL=...
DIRECT_URL=...
AUTH_SECRET=...                       # genera con: npx auth secret
NEXTAUTH_SECRET=...                   # mismo valor
NEXTAUTH_URL=https://tu-dominio.vercel.app
AUTH_TRUST_HOST=true
NEXT_PUBLIC_APP_URL=https://tu-dominio.vercel.app
PAYMENT_PROVIDER=mock                 # cambia a stripe/ccbill cuando esté listo
```

Y las opcionales de LiveKit, S3 y pagos que vayas a usar.

### 4. Desplegar y sembrar

Despliega. Para cargar los datos de prueba en el entorno remoto (**solo en un entorno de pruebas, nunca en producción real**):

```bash
DATABASE_URL="tu-url-directa" npm run db:seed
```

### 5. Webhook de Stripe

Si usas Stripe, añade el endpoint `https://tu-dominio.vercel.app/api/webhooks/stripe` en el dashboard, suscribe el evento `checkout.session.completed` y copia el signing secret a `STRIPE_WEBHOOK_SECRET`.

### Notas de producción

- El SSE de matchmaking corta a los ~55 s y el cliente reconecta solo. En el plan Hobby las funciones tienen un límite de 60 s; `vercel.json` ya lo configura.
- Si esperas mucha concurrencia en la cola, mueve el matchmaking a Redis (Upstash) o a un servidor de señalización dedicado fuera de serverless.
- `robots` está en `noindex` a propósito. Quítalo en `src/app/layout.tsx` solo cuando el cumplimiento legal esté cerrado.

---

## Scripts disponibles

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo |
| `npm run build` | Build de producción (genera Prisma Client) |
| `npm start` | Sirve el build |
| `npm run typecheck` | TypeScript sin emitir |
| `npm run lint` | ESLint |
| `npm run db:up` / `db:down` | Levanta / apaga los contenedores |
| `npm run db:migrate` | Crea y aplica una migración |
| `npm run db:deploy` | Aplica migraciones (producción) |
| `npm run db:seed` | Puebla con datos ficticios |
| `npm run db:reset` | Borra, migra y siembra de nuevo |
| `npm run db:studio` | GUI de Prisma en el navegador |
| `npm run setup:local` | Todo lo anterior encadenado |

---

## Estado de verificación

Lo que se comprobó ejecutándolo de verdad en este entorno (Windows, Node 24.13, PostgreSQL 18.4):

- ✅ `prisma generate` — esquema válido, 25 modelos, 19 enums
- ✅ `tsc --noEmit` — sin errores de tipos
- ✅ `next build` — 30+ rutas compiladas
- ✅ `prisma migrate` — migración inicial de 616 líneas aplicada
- ✅ `prisma/seed.ts` — completa sin errores y con los volúmenes esperados
- ✅ `/api/health` — reporta conexión a BD con datos cargados
- ✅ Smoke test anónimo — 13 rutas públicas responden 200; las protegidas redirigen a `/login`; la home renderiza modelos reales del seed; el filtro por género del catálogo devuelve el subconjunto correcto
- ✅ **Login real end-to-end** — CSRF → credenciales → cookie de sesión con el rol correcto; un `USER` que entra en `/admin` es redirigido a `/403`
- ✅ **29 rutas autenticadas** recorridas con sesión real de los tres roles (admin, modelo, usuario) — todas 200, sin errores en el log del servidor

### Fallos encontrados y corregidos durante la verificación

Los cuatro aparecieron solo al ejecutar de verdad; ninguno lo detectó el `build`:

1. **Encoding de la base de datos** — al crear el cluster con el locale del sistema (WIN1252 en Windows), los emojis de los regalos rompían el seed. `docker-compose.yml` fuerza ahora `--encoding=UTF8`.
2. **`require()` en `tailwind.config.ts`** — Node 24 lo rechaza dentro de un módulo ES y tumbaba el servidor de desarrollo al compilar la primera página. Sustituido por `import animate from 'tailwindcss-animate'`.
3. **`DIRECT_URL=""` en `.env.example`** — Prisma aborta con `P1012: You must provide a nonempty direct URL`. Ahora trae la cadena local, con el comentario de cómo separarla en producción.
4. **Iconos cruzando la frontera Server → Client** — los layouts pasaban componentes de Lucide (funciones) al sidebar, que es Client Component; React no puede serializarlas y **los paneles de admin y de modelo devolvían 500 completos**. El sidebar recibe ahora un nombre de icono y resuelve el componente en cliente.

El cuarto es el más instructivo: solo se manifiesta con sesión iniciada, así que un smoke test anónimo lo daba por bueno — la ruta protegida redirige a `/login`, que responde 200 y enmascara el fallo. Por eso la batería de pruebas incluye ahora un recorrido autenticado por rol.

**No verificado en ejecución** (requiere credenciales externas de las que no dispongo): la conexión real a LiveKit con dos participantes, la subida a S3/R2 con URLs firmadas y el flujo de pago real de Stripe/CCBill. El código de estas integraciones está escrito y compila; su ruta sin configurar (modo demo, aviso de almacenamiento, proveedor `mock`) sí está probada.

---

## Licencia

Sin licencia definida. Añade la que corresponda antes de publicar el repositorio.
"# fantasylive" 
"# fantasylive" 
"# fantasylive" 
"# fantasylive" 
