import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { config } from '@/lib/config';

export const dynamic = 'force-static';

type LegalDoc = {
  title: string;
  updated: string;
  sections: Array<{ heading: string; body: string[] }>;
};

const DOCS: Record<string, LegalDoc> = {
  terms: {
    title: 'Terminos de servicio',
    updated: '2026-01-01',
    sections: [
      {
        heading: '1. Edad minima y elegibilidad',
        body: [
          'El acceso a FantasyLive esta restringido a personas mayores de 18 anos o de la mayoria de edad legal en su jurisdiccion, la que sea mayor. Al registrarte declaras cumplir este requisito.',
          'La plataforma se reserva el derecho de solicitar verificacion documental de la edad en cualquier momento y de suspender las cuentas que no la superen.',
        ],
      },
      {
        heading: '2. Naturaleza del servicio',
        body: [
          'FantasyLive es una plataforma de intermediacion que conecta a usuarios con creadores adultos independientes mediante videollamadas y contenido digital. Los creadores no son empleados de la plataforma.',
          'El contenido y las conversaciones son responsabilidad de sus autores. La plataforma no produce contenido propio.',
        ],
      },
      {
        heading: '3. Tokens y pagos',
        body: [
          'Los tokens son creditos digitales prepagados sin valor monetario fuera de la plataforma. No son reembolsables salvo por error tecnico acreditado o resolucion de una disputa a favor del usuario.',
          'Los tokens no caducan mientras la cuenta permanezca activa. El consumo se realiza por minuto en llamadas de pago y por unidad en desbloqueos de contenido y propinas.',
          'La plataforma retiene una comision sobre cada transaccion, comunicada a los creadores en su panel de ganancias.',
        ],
      },
      {
        heading: '4. Conducta prohibida',
        body: [
          'Queda terminantemente prohibido: participar siendo menor de edad o facilitar el acceso a menores; compartir contenido no consentido; grabar, capturar o redistribuir sesiones sin autorizacion expresa; acosar, amenazar o suplantar a otras personas; y cualquier actividad ilicita.',
          'El incumplimiento supone la suspension o el cierre inmediato de la cuenta, la retencion de saldos vinculados a la infraccion y, cuando proceda, la comunicacion a las autoridades competentes.',
        ],
      },
      {
        heading: '5. Grabacion y privacidad de las sesiones',
        body: [
          'Las videollamadas no se graban por parte de la plataforma. Grabar a otra persona sin su consentimiento explicito esta prohibido y puede constituir un delito.',
        ],
      },
      {
        heading: '6. Limitacion de responsabilidad',
        body: [
          'El servicio se presta "tal cual". La plataforma no garantiza disponibilidad ininterrumpida ni resultados concretos de las interacciones entre usuarios.',
        ],
      },
    ],
  },
  privacy: {
    title: 'Politica de privacidad',
    updated: '2026-01-01',
    sections: [
      {
        heading: '1. Responsable del tratamiento',
        body: [
          `FantasyLive trata tus datos personales conforme al RGPD (UE 2016/679) y a la normativa local aplicable. Contacto: ${config.moderation.adminAlertEmail}.`,
        ],
      },
      {
        heading: '2. Datos que recogemos',
        body: [
          'Datos de cuenta: email, nombre, fecha de nacimiento, pais y preferencias de perfil.',
          'Datos de uso: historial de llamadas (metadatos, no contenido), transacciones de tokens, contenido desbloqueado y reportes emitidos.',
          'Datos de verificacion (solo creadores): documento de identidad, selfie y datos de cobro, tratados con base legal en el cumplimiento de obligaciones legales (18 U.S.C. 2257 y normativa antifraude).',
        ],
      },
      {
        heading: '3. Conservacion',
        body: [
          'Los datos de verificacion se conservan durante el periodo exigido por la ley aplicable. El resto de datos se conserva mientras la cuenta este activa y durante los plazos de prescripcion legal posteriores.',
        ],
      },
      {
        heading: '4. Tus derechos',
        body: [
          'Puedes ejercer los derechos de acceso, rectificacion, supresion, oposicion, limitacion y portabilidad escribiendo desde tu email registrado. Responderemos en el plazo maximo de un mes.',
        ],
      },
      {
        heading: '5. Terceros',
        body: [
          'Compartimos datos estrictamente necesarios con: proveedores de pago (para procesar cobros), proveedores de infraestructura de video y almacenamiento, y autoridades cuando exista requerimiento legal.',
        ],
      },
    ],
  },
  '2257': {
    title: 'Declaracion de cumplimiento 18 U.S.C. 2257',
    updated: '2026-01-01',
    sections: [
      {
        heading: 'Declaracion de mantenimiento de registros',
        body: [
          'Todos los modelos, actores, actrices y demas personas que aparecen en cualquier representacion visual de conducta sexualmente explicita real o simulada publicada en esta plataforma tenian 18 anos de edad o mas en el momento de la creacion de dichas representaciones.',
          'FantasyLive verifica la identidad y la edad de cada creador mediante documentacion oficial antes de permitir la emision o publicacion de contenido. Los registros exigidos por 18 U.S.C. 2257 y 28 C.F.R. 75 se conservan por el custodio de registros designado.',
        ],
      },
      {
        heading: 'Contenido generado por usuarios',
        body: [
          'La plataforma actua como proveedor de servicios respecto del contenido subido por terceros. Cada creador es el productor primario de su propio contenido y mantiene los registros originales correspondientes.',
        ],
      },
      {
        heading: 'Custodio de registros',
        body: [
          `Las solicitudes relativas a los registros 2257 deben dirigirse a ${config.moderation.adminAlertEmail}.`,
        ],
      },
    ],
  },
  dmca: {
    title: 'Politica DMCA',
    updated: '2026-01-01',
    sections: [
      {
        heading: 'Notificacion de infraccion',
        body: [
          `Si eres titular de derechos y consideras que un contenido publicado infringe tu propiedad intelectual, envia una notificacion a ${config.moderation.adminAlertEmail} incluyendo: identificacion de la obra, URL del contenido infractor, tus datos de contacto, una declaracion de buena fe y tu firma.`,
        ],
      },
      {
        heading: 'Retirada y contranotificacion',
        body: [
          'El contenido notificado se retira de forma cautelar mientras se revisa la reclamacion. El creador afectado puede presentar una contranotificacion aportando prueba de titularidad.',
        ],
      },
      {
        heading: 'Contenido intimo no consentido',
        body: [
          'Las denuncias por publicacion de imagenes intimas sin consentimiento se tramitan con prioridad absoluta y suponen la retirada inmediata del contenido y el bloqueo de la cuenta responsable.',
        ],
      },
    ],
  },
};

export async function generateStaticParams() {
  return Object.keys(DOCS).map((doc) => ({ doc }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ doc: string }>;
}): Promise<Metadata> {
  const { doc } = await params;
  return { title: DOCS[doc]?.title ?? 'Legal' };
}

export default async function LegalPage({
  params,
}: {
  params: Promise<{ doc: string }>;
}) {
  const { doc } = await params;
  const content = DOCS[doc];

  if (!content) notFound();

  return (
    <div className="container max-w-3xl py-14">
      <h1 className="text-3xl font-bold tracking-tight">{content.title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">
        Ultima actualizacion: {content.updated}
      </p>

      <div className="mt-10 space-y-10">
        {content.sections.map((section) => (
          <section key={section.heading}>
            <h2 className="text-lg font-semibold">{section.heading}</h2>
            <div className="mt-3 space-y-3">
              {section.body.map((paragraph, i) => (
                <p key={i} className="leading-relaxed text-muted-foreground">
                  {paragraph}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>

      <div className="mt-14 rounded-lg border border-border bg-card/50 p-4 text-sm text-muted-foreground">
        Este documento es una plantilla de referencia para desarrollo. Antes de
        operar en produccion debe ser revisado y adaptado por un profesional
        juridico segun la jurisdiccion de explotacion.
      </div>
    </div>
  );
}
