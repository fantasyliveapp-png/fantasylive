'use client';

import { useRouter } from 'next/navigation';

import { PostStudio, type StudioModel } from '@/components/feed/post-studio';
import type { EconomyParams } from '@/lib/earnings';

/**
 * Abre el estudio de publicacion y nada mas: no hay una pagina propia con
 * "tus publicaciones" detras (tus publicaciones estan en tu perfil).
 *
 * - X (sin publicar): vuelve a donde estabas.
 * - Listo (tras publicar): va a tu perfil, donde aparece la publicacion.
 */
export function StudioLauncher({
  model,
  economy,
  subscriptionEnabled,
  profileHref,
  liveExclusive = false,
}: {
  model: StudioModel;
  economy: EconomyParams;
  subscriptionEnabled: boolean;
  profileHref: string;
  /** Nuevo pack de directo: al terminar vuelve a Contenido → Para directos. */
  liveExclusive?: boolean;
}) {
  const router = useRouter();

  function leave() {
    // Volver atras solo si se llego desde la propia web; si se abrio el
    // enlace directamente, al perfil (atras sacaria de Fantasy Live).
    const cameFromApp =
      window.history.length > 1 &&
      (!document.referrer || document.referrer.startsWith(window.location.origin));
    if (cameFromApp) router.back();
    else router.replace(profileHref);
  }

  return (
    <PostStudio
      initialFiles={[]}
      economy={economy}
      subscriptionEnabled={subscriptionEnabled}
      model={model}
      onClose={leave}
      initialLiveExclusive={liveExclusive}
      onDone={() => {
        router.replace(liveExclusive ? '/dashboard/model/contenido?tab=directos' : profileHref);
        router.refresh();
      }}
    />
  );
}
