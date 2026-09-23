'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Camera, Loader2, Lock, UserCheck, UserPlus, X } from 'lucide-react';
import { toast } from 'sonner';

import { ImageCropDialog } from '@/components/model/profile-editor';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { putToSignedUrl, readImageSize, renderCroppedImage } from '@/lib/blur-preview';
import type { CropState } from '@/lib/post-formats';
import { USERNAME_PATTERN } from '@/lib/usernames';
import { cn, initials } from '@/lib/utils';
import {
  requestUserAvatarUploadUrlAction,
  toggleUserFollowAction,
  updateUserProfileAction,
} from '@/server/actions/social';

/** Boton Seguir de un perfil de persona, con respuesta inmediata. */
export function FollowPersonButton({
  userId,
  initialFollowing,
  isAuthenticated,
  onCountChange,
}: {
  userId: string;
  initialFollowing: boolean;
  isAuthenticated: boolean;
  onCountChange?: (followers: number) => void;
}) {
  const router = useRouter();
  const [following, setFollowing] = useState(initialFollowing);
  const [isPending, startTransition] = useTransition();

  function toggle() {
    if (!isAuthenticated) {
      router.push('/login');
      return;
    }
    const previous = following;
    setFollowing(!previous);
    startTransition(async () => {
      const result = await toggleUserFollowAction(userId);
      if (!result.ok || !result.data) {
        setFollowing(previous);
        toast.error(result.error ?? 'No se pudo completar.');
        return;
      }
      setFollowing(result.data.following);
      onCountChange?.(result.data.followers);
      router.refresh();
    });
  }

  return (
    <Button
      variant={following ? 'secondary' : 'brand'}
      className="h-10 flex-1 px-5 sm:flex-none"
      onClick={toggle}
      disabled={isPending}
    >
      {following ? <UserCheck className="h-4 w-4" /> : <UserPlus className="h-4 w-4" />}
      {following ? 'Siguiendo' : 'Seguir'}
    </Button>
  );
}

export interface EditableUserProfile {
  name: string;
  username: string;
  bio: string;
  image: string;
  isProfilePublic: boolean;
}

/**
 * Editor del perfil de una cuenta (fan): foto, nombre, @usuario, bio y si el
 * perfil es publico. Privado por defecto: con el interruptor apagado solo se
 * ve el nombre y la foto.
 */
export function UserProfileEditor({
  profile,
  children,
}: {
  profile: EditableUserProfile;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  const [name, setName] = useState(profile.name);
  const [username, setUsername] = useState(profile.username);
  const [bio, setBio] = useState(profile.bio);
  const [image, setImage] = useState(profile.image);
  const [isPublic, setIsPublic] = useState(profile.isProfilePublic);
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [cropping, setCropping] = useState<{ file: File; url: string; width: number; height: number } | null>(null);
  const fileInput = useRef<HTMLInputElement | null>(null);

  const usernameOk = USERNAME_PATTERN.test(username);

  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  async function pick(file: File | undefined) {
    if (!file || !file.type.startsWith('image/')) return;
    const size = await readImageSize(file);
    if (!size) {
      toast.error('No se puede leer esa imagen.');
      return;
    }
    setCropping({ file, url: URL.createObjectURL(file), ...size });
  }

  async function applyCrop(crop: CropState) {
    if (!cropping) return;
    const { file, url } = cropping;
    setCropping(null);
    URL.revokeObjectURL(url);
    const blob = await renderCroppedImage(file, { width: 512, height: 512 }, crop);
    if (!blob) return;
    const local = URL.createObjectURL(blob);
    setPreview(local);
    setUploading(true);
    const signed = await requestUserAvatarUploadUrlAction();
    const ok =
      signed.ok && signed.data
        ? await putToSignedUrl(signed.data.uploadUrl, blob, 'image/jpeg').catch(() => false)
        : false;
    setUploading(false);
    if (!ok || !signed.data) {
      // La vista local no debe mostrar algo que no se va a guardar.
      setPreview(null);
      URL.revokeObjectURL(local);
      toast.error(signed.error ?? 'No se pudo subir la foto.');
      return;
    }
    setImage(signed.data.publicUrl);
  }

  function save() {
    startTransition(async () => {
      const result = await updateUserProfileAction({
        name,
        username,
        bio,
        image,
        isProfilePublic: isPublic,
      });
      if (!result.ok || !result.data) {
        toast.error(result.error ?? 'No se pudo guardar.');
        return;
      }
      toast.success('Perfil guardado');
      setOpen(false);
      if (result.data.username !== profile.username) {
        router.replace(`/u/${result.data.username}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <Button variant="secondary" className="h-10 flex-1 px-5 sm:flex-none" onClick={() => setOpen(true)}>
        {children}
      </Button>

      {open && (
        <div
          className="fixed inset-0 !m-0 z-[60] flex bg-black/70 backdrop-blur-md md:items-center md:justify-center md:p-6"
          role="dialog"
          aria-modal="true"
          aria-label="Editar perfil"
        >
          <input
            ref={fileInput}
            type="file"
            accept="image/*"
            hidden
            onChange={(e) => {
              void pick(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <div className="flex h-full w-full flex-col overflow-hidden bg-background md:h-auto md:max-h-[92vh] md:max-w-md md:rounded-[2rem] md:border md:border-border/60">
            <header className="flex h-14 shrink-0 items-center gap-2 border-b border-border/60 px-2">
              <Button variant="ghost" size="icon" onClick={() => setOpen(false)} aria-label="Cerrar">
                <X className="h-5 w-5" />
              </Button>
              <h2 className="flex-1 text-center font-heading text-sm uppercase tracking-[0.2em]">
                Editar perfil
              </h2>
              <Button
                variant="ghost"
                size="sm"
                onClick={save}
                disabled={isPending || uploading || !usernameOk || name.trim().length < 2}
                className="font-semibold text-primary hover:text-primary"
              >
                {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                Guardar
              </Button>
            </header>

            <div className="flex-1 space-y-6 overflow-y-auto p-5">
              <button
                type="button"
                onClick={() => fileInput.current?.click()}
                className="relative mx-auto block"
                aria-label="Cambiar foto"
              >
                <Avatar className="h-24 w-24">
                  {(preview ?? image) && <AvatarImage src={preview ?? image} alt="" />}
                  <AvatarFallback className="text-2xl">{initials(name)}</AvatarFallback>
                </Avatar>
                <span className="absolute bottom-0 right-0 flex h-8 w-8 items-center justify-center rounded-full border-2 border-background bg-primary text-primary-foreground">
                  {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
                </span>
              </button>

              <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60">
                <label className="flex items-center gap-4 px-4 py-3">
                  <span className="w-20 shrink-0 text-sm font-medium">Nombre</span>
                  <input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={60}
                    className="w-full min-w-0 bg-transparent text-sm outline-none"
                  />
                </label>
                <label className="flex items-center gap-4 px-4 py-3">
                  <span className="w-20 shrink-0 text-sm font-medium">Usuario</span>
                  <span className="text-sm text-muted-foreground">@</span>
                  <input
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/\s+/g, ''))}
                    maxLength={30}
                    className={cn(
                      'w-full min-w-0 bg-transparent text-sm outline-none',
                      !usernameOk && 'text-destructive',
                    )}
                  />
                </label>
                <label className="flex items-start gap-4 px-4 py-3">
                  <span className="w-20 shrink-0 text-sm font-medium">Bio</span>
                  <textarea
                    value={bio}
                    onChange={(e) => setBio(e.target.value)}
                    maxLength={300}
                    rows={3}
                    placeholder="Algo sobre ti (opcional)"
                    className="w-full min-w-0 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                  />
                </label>
              </div>
              {!usernameOk && (
                <p className="-mt-4 text-xs text-destructive">
                  De 3 a 30 caracteres: letras, numeros, punto, guion o guion bajo.
                </p>
              )}

              <div className="flex items-start gap-3 rounded-2xl border border-border/60 p-4">
                <Lock className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium">Perfil publico</p>
                  <p className="text-xs text-muted-foreground">
                    {isPublic
                      ? 'Cualquiera ve tu bio, tus seguidores y a quien sigues.'
                      : 'Privado: solo se ve tu nombre y tu foto. Nadie ve tu bio ni a quien sigues.'}
                  </p>
                </div>
                <Switch checked={isPublic} onCheckedChange={setIsPublic} aria-label="Perfil publico" />
              </div>
            </div>
          </div>

          {cropping && (
            <ImageCropDialog
              kind="avatar"
              src={cropping.url}
              naturalWidth={cropping.width}
              naturalHeight={cropping.height}
              onCancel={() => {
                URL.revokeObjectURL(cropping.url);
                setCropping(null);
              }}
              onApply={(crop) => void applyCrop(crop)}
            />
          )}
        </div>
      )}
    </>
  );
}
