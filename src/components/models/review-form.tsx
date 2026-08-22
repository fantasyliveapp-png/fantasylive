'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2, Star } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { upsertReviewAction } from '@/server/actions/reviews';

export function ReviewForm({
  modelId,
  slug,
  initialRating,
  initialComment,
}: {
  modelId: string;
  slug: string;
  initialRating?: number;
  initialComment?: string | null;
}) {
  const router = useRouter();
  const [rating, setRating] = useState(initialRating ?? 0);
  const [hoverRating, setHoverRating] = useState(0);
  const [comment, setComment] = useState(initialComment ?? '');
  const [isPending, startTransition] = useTransition();

  function submit() {
    if (rating < 1) {
      toast.error('Elegi una puntuacion de 1 a 5 estrellas.');
      return;
    }
    startTransition(async () => {
      const result = await upsertReviewAction({ modelId, slug, rating, comment });
      if (result.ok) {
        toast.success(result.message ?? 'Resena guardada');
        router.refresh();
      } else {
        toast.error(result.error ?? 'No se pudo guardar la resena');
      }
    });
  }

  return (
    <div className="rounded-lg border border-border p-4">
      <p className="text-sm font-medium">
        {initialRating ? 'Editar mi resena' : 'Dejar una resena'}
      </p>

      <div className="mt-2 flex gap-1">
        {[1, 2, 3, 4, 5].map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => setRating(n)}
            onMouseEnter={() => setHoverRating(n)}
            onMouseLeave={() => setHoverRating(0)}
            className="p-0.5"
            aria-label={`${n} estrellas`}
          >
            <Star
              className={`h-6 w-6 ${
                n <= (hoverRating || rating)
                  ? 'fill-amber-400 text-amber-400'
                  : 'text-muted-foreground'
              }`}
            />
          </button>
        ))}
      </div>

      <Textarea
        value={comment}
        onChange={(e) => setComment(e.target.value)}
        maxLength={600}
        rows={3}
        placeholder="Conta como fue tu experiencia (opcional)"
        className="mt-3"
      />

      <Button
        variant="brand"
        size="sm"
        className="mt-3"
        onClick={submit}
        disabled={isPending}
      >
        {isPending && <Loader2 className="h-4 w-4 animate-spin" />}
        {initialRating ? 'Actualizar resena' : 'Publicar resena'}
      </Button>
    </div>
  );
}
