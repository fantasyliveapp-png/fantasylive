-- Minimo de la llamada que paga el fan si cuelga el antes.
ALTER TABLE "call_sessions" ADD COLUMN "minBilledSeconds" INTEGER NOT NULL DEFAULT 0;

-- Privados 1 a 1 durante un directo (se pregunta al empezar).
ALTER TABLE "live_streams" ADD COLUMN "acceptsPrivate" BOOLEAN NOT NULL DEFAULT false;
