'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { ExternalLink, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { LANGUAGES, MODEL_TAGS } from '@/lib/constants';
import { updateModelProfileAction } from '@/server/actions/model';

export function ProfileForm({
  stageName: initialStageName,
  headline: initialHeadline,
  bio: initialBio,
  languages: initialLanguages,
  tags: initialTags,
  avatarUrl: initialAvatar,
  coverUrl: initialCover,
  slug,
}: {
  stageName: string;
  headline: string;
  bio: string;
  languages: string[];
  tags: string[];
  avatarUrl: string;
  coverUrl: string;
  slug: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [stageName, setStageName] = useState(initialStageName);
  const [headline, setHeadline] = useState(initialHeadline);
  const [bio, setBio] = useState(initialBio);
  const [languages, setLanguages] = useState<string[]>(initialLanguages);
  const [tags, setTags] = useState<string[]>(initialTags);
  const [avatarUrl, setAvatarUrl] = useState(initialAvatar);
  const [coverUrl, setCoverUrl] = useState(initialCover);

  function toggle(list: string[], setter: (v: string[]) => void, value: string, max: number) {
    if (list.includes(value)) {
      setter(list.filter((v) => v !== value));
    } else if (list.length < max) {
      setter([...list, value]);
    } else {
      toast.error(`Maximo ${max} elementos.`);
    }
  }

  function save() {
    startTransition(async () => {
      const result = await updateModelProfileAction({
        stageName,
        headline,
        bio,
        languages,
        tags,
        avatarUrl,
        coverUrl,
      });

      if (result.ok) {
        toast.success(result.message ?? 'Perfil guardado');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo guardar el perfil');
      }
    });
  }

  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Perfil publico</CardTitle>
          <CardDescription>
            Asi te ven los usuarios en el catalogo.
          </CardDescription>
        </div>
        <Link href={`/models/${slug}`} target="_blank">
          <Button variant="outline" size="sm">
            <ExternalLink className="h-4 w-4" />
            Ver perfil
          </Button>
        </Link>
      </CardHeader>

      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="stageName">Nombre artistico</Label>
            <Input
              id="stageName"
              value={stageName}
              onChange={(e) => setStageName(e.target.value)}
              maxLength={40}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="headline">Titular</Label>
            <Input
              id="headline"
              value={headline}
              onChange={(e) => setHeadline(e.target.value)}
              maxLength={120}
              placeholder="Una frase que te describa"
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="bio">Biografia</Label>
          <Textarea
            id="bio"
            value={bio}
            onChange={(e) => setBio(e.target.value)}
            maxLength={1200}
            className="min-h-[120px]"
            placeholder="Cuenta quien eres, que te gusta y como son tus sesiones..."
          />
          <p className="text-xs text-muted-foreground">
            {bio.length}/1200 caracteres
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="avatarUrl">URL del avatar</Label>
            <Input
              id="avatarUrl"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="coverUrl">URL de la portada</Label>
            <Input
              id="coverUrl"
              value={coverUrl}
              onChange={(e) => setCoverUrl(e.target.value)}
              placeholder="https://..."
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label>Idiomas (max. 5)</Label>
          <div className="flex flex-wrap gap-1.5">
            {LANGUAGES.map((lang) => (
              <button
                key={lang}
                type="button"
                onClick={() => toggle(languages, setLanguages, lang, 5)}
              >
                <Badge
                  variant={languages.includes(lang) ? 'default' : 'muted'}
                  className="cursor-pointer hover:opacity-80"
                >
                  {lang}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <Label>Etiquetas (max. 8)</Label>
          <div className="flex flex-wrap gap-1.5">
            {MODEL_TAGS.map((tag) => (
              <button
                key={tag}
                type="button"
                onClick={() => toggle(tags, setTags, tag, 8)}
              >
                <Badge
                  variant={tags.includes(tag) ? 'default' : 'muted'}
                  className="cursor-pointer capitalize hover:opacity-80"
                >
                  {tag}
                </Badge>
              </button>
            ))}
          </div>
        </div>

        <Button variant="brand" onClick={save} disabled={isPending}>
          {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
          Guardar perfil
        </Button>
      </CardContent>
    </Card>
  );
}
