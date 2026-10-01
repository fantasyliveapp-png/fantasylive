-- El menu de propinas puede mostrarse como panel sobre el directo.
ALTER TABLE "live_streams" ADD COLUMN "tipMenuOnScreen" BOOLEAN NOT NULL DEFAULT false;
