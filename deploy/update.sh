#!/usr/bin/env bash
#############################################################################
# FantasyLive - actualizar el VPS a la ultima version
#
# Uso (como root en el servidor):
#   bash /var/www/fantasylive/deploy/update.sh
#
# Es idempotente: se puede volver a ejecutar sin miedo. Si algo falla, para
# en ese punto (set -e) y NO reinicia el servicio, de modo que la version
# que ya estaba sirviendo sigue en pie.
#
# OJO CON EL AUTO-REEMPLAZO: este script vive DENTRO del repo que el propio
# script actualiza, asi que `git reset --hard` reescribe el fichero mientras
# bash lo esta ejecutando. Bash lee los scripts por trozos, no de una vez, y
# eso le hace continuar leyendo desde un desplazamiento que ya no corresponde
# a la misma linea: el resultado es un error de sintaxis aleatorio a mitad del
# despliegue. Por eso todo el cuerpo va dentro de main(), que bash parsea
# completo antes de ejecutar nada.
#############################################################################

set -euo pipefail

main() {
  local APP_DIR="${APP_DIR:-/var/www/fantasylive}"
  local APP_USER="${APP_USER:-fantasylive}"
  local SERVICE="${SERVICE:-fantasylive}"

  echo "==> Directorio: $APP_DIR"
  cd "$APP_DIR"

  # El .env no esta en git: si falta, el build arrancaria con valores por
  # defecto y la app quedaria apuntando a localhost.
  if [[ ! -f .env ]]; then
    echo "ERROR: falta $APP_DIR/.env. Copialo de .env.example y rellenalo." >&2
    exit 1
  fi

  echo "==> Trayendo cambios de git"
  git fetch --all --prune
  git reset --hard origin/main

  echo "==> Dependencias"
  sudo -u "$APP_USER" npm ci

  echo "==> Migraciones de base de datos"
  # migrate deploy NO borra datos: solo aplica las migraciones pendientes.
  sudo -u "$APP_USER" npx prisma migrate deploy

  echo "==> Build"
  sudo -u "$APP_USER" npm run build

  echo "==> Reiniciando $SERVICE"
  systemctl restart "$SERVICE"

  # Espera activa a que el healthcheck responda antes de decir que fue bien:
  # un restart que devuelve 0 no garantiza que la app haya arrancado.
  echo "==> Comprobando /api/health"
  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 3 http://127.0.0.1:3000/api/health >/dev/null 2>&1; then
      echo "OK: la aplicacion responde."
      return 0
    fi
    sleep 2
  done

  echo "ERROR: la aplicacion no responde en /api/health tras 60 s." >&2
  echo "Revisa: journalctl -u $SERVICE -n 80 --no-pager" >&2
  return 1
}

main "$@"
