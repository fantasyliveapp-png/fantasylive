#!/usr/bin/env bash
#############################################################################
# FantasyLive - almacenamiento propio (MinIO) en el mismo servidor
#
# Uso (como root en el servidor):
#   bash /var/www/fantasylive/deploy/setup-storage.sh https://tudominio.com
#
# Los archivos se sirven desde el MISMO dominio de la web, bajo
# https://tudominio.com/<bucket>/..., asi que no hace falta ningun registro
# DNS ni certificado nuevo: nginx pasa esa ruta a MinIO tal cual.
#
# Por que funciona sin reescribir nada: las URLs firmadas de S3 incluyen el
# host y la ruta en la firma. En modo "path style" la ruta ya empieza por el
# nombre del bucket, y nginx la entrega a MinIO sin tocarla ni cambiar el
# Host, asi que la firma sigue siendo valida. Al ser el mismo origen que la
# web, el navegador sube sin necesitar CORS.
#
# Que hace:
#   1. Instala MinIO y su cliente (mc) si no estan.
#   2. Crea el usuario de servicio, /var/lib/minio y /etc/default/minio con
#      unas credenciales de administrador aleatorias (solo root las lee).
#   3. Arranca MinIO escuchando solo en 127.0.0.1.
#   4. Crea el bucket, deja publica solo la carpeta previews/ (miniaturas
#      borrosas) y crea un usuario solo para la app, distinto del admin.
#   5. Anade a la web de nginx la ruta /<bucket>/ hacia MinIO.
#   6. Escribe las variables S3_* en el .env de la app (con copia de
#      seguridad) y reinicia la app.
#
# Es idempotente: se puede volver a ejecutar. No regenera credenciales que ya
# existen ni borra archivos.
#
# Todo va dentro de main() por el mismo motivo que update.sh: bash no debe
# leer el script a trozos mientras algo lo modifica.
#############################################################################

set -euo pipefail

main() {
  local APP_URL="${1:-}"
  local APP_DIR="${APP_DIR:-/var/www/fantasylive}"
  local APP_USER="${APP_USER:-fantasylive}"
  local SERVICE="${SERVICE:-fantasylive}"
  local BUCKET="${BUCKET:-fantasylive-content}"
  local NGINX_SITE="${NGINX_SITE:-/etc/nginx/sites-available/fantasylive}"
  local APP_S3_USER="fantasylive-app"

  APP_URL="${APP_URL%/}"
  if [[ "$APP_URL" != https://* ]]; then
    echo "Uso: bash $0 https://tudominio.com" >&2
    exit 1
  fi
  local DOMAIN="${APP_URL#https://}"

  if [[ $EUID -ne 0 ]]; then
    echo "ERROR: ejecutalo como root (sudo)." >&2
    exit 1
  fi
  if [[ ! -f "$APP_DIR/.env" ]]; then
    echo "ERROR: no encuentro $APP_DIR/.env." >&2
    exit 1
  fi
  if [[ ! -f "$NGINX_SITE" ]]; then
    echo "ERROR: no encuentro la web de nginx en $NGINX_SITE." >&2
    exit 1
  fi
  if ! grep -q "server_name ${DOMAIN};" "$NGINX_SITE"; then
    echo "ERROR: $NGINX_SITE no tiene 'server_name ${DOMAIN};'. Revisa el dominio." >&2
    exit 1
  fi

  # --- 1. Binarios --------------------------------------------------------
  local arch
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) echo "ERROR: arquitectura no soportada: $(uname -m)" >&2; exit 1 ;;
  esac

  if [[ ! -x /usr/local/bin/minio ]]; then
    echo "==> Instalando MinIO"
    curl -fsSL "https://dl.min.io/server/minio/release/linux-${arch}/minio" -o /usr/local/bin/minio
    chmod +x /usr/local/bin/minio
  fi
  if [[ ! -x /usr/local/bin/mc ]]; then
    echo "==> Instalando el cliente mc"
    curl -fsSL "https://dl.min.io/client/mc/release/linux-${arch}/mc" -o /usr/local/bin/mc
    chmod +x /usr/local/bin/mc
  fi

  # --- 2. Usuario, datos y credenciales de administrador --------------------
  if ! id minio-user >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin minio-user
  fi
  mkdir -p /var/lib/minio
  chown minio-user:minio-user /var/lib/minio

  if [[ ! -f /etc/default/minio ]]; then
    echo "==> Generando credenciales de administrador de MinIO"
    umask 077
    cat > /etc/default/minio <<EOF
# Generado por deploy/setup-storage.sh. Solo root debe leer este fichero.
MINIO_ROOT_USER=admin-$(openssl rand -hex 4)
MINIO_ROOT_PASSWORD=$(openssl rand -hex 24)
MINIO_VOLUMES=/var/lib/minio
MINIO_OPTS="--address 127.0.0.1:9000 --console-address 127.0.0.1:9001"
EOF
    umask 022
  fi
  chmod 600 /etc/default/minio

  # --- 3. Servicio ----------------------------------------------------------
  echo "==> Arrancando MinIO"
  cp "$APP_DIR/deploy/minio.service" /etc/systemd/system/minio.service
  systemctl daemon-reload
  systemctl enable --now minio
  systemctl restart minio

  local i
  for i in $(seq 1 30); do
    if curl -fsS --max-time 2 http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
  if ! curl -fsS --max-time 2 http://127.0.0.1:9000/minio/health/live >/dev/null 2>&1; then
    echo "ERROR: MinIO no arranca. Revisa: journalctl -u minio -n 80 --no-pager" >&2
    exit 1
  fi

  # --- 4. Bucket y usuario de la app ---------------------------------------
  echo "==> Configurando el bucket $BUCKET"
  # shellcheck disable=SC1091
  set -a && source /etc/default/minio && set +a
  mc alias set fl-local http://127.0.0.1:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
  mc mb --ignore-existing "fl-local/$BUCKET" >/dev/null
  # Solo las miniaturas borrosas son publicas; el resto va con URL firmada.
  mc anonymous set download "fl-local/$BUCKET/previews" >/dev/null

  local app_key="" app_secret=""
  if grep -q "^S3_ENDPOINT=\"${APP_URL}\"" "$APP_DIR/.env" \
    && mc admin user info fl-local "$APP_S3_USER" >/dev/null 2>&1; then
    echo "    La app ya tiene sus credenciales: no se cambian."
  else
    echo "==> Creando el usuario de la app en MinIO"
    app_key="$APP_S3_USER"
    app_secret="$(openssl rand -hex 24)"
    if mc admin user info fl-local "$APP_S3_USER" >/dev/null 2>&1; then
      mc admin user remove fl-local "$APP_S3_USER" >/dev/null
    fi
    mc admin user add fl-local "$app_key" "$app_secret" >/dev/null
    mc admin policy attach fl-local readwrite --user "$app_key" >/dev/null
  fi

  # --- 5. nginx: /<bucket>/ -> MinIO en la web existente --------------------
  echo "==> Publicando $APP_URL/$BUCKET/ en nginx"
  sed "s/__BUCKET__/${BUCKET}/g" "$APP_DIR/deploy/nginx-storage.conf" \
    > /etc/nginx/snippets/fantasylive-storage.conf
  if ! grep -q "snippets/fantasylive-storage.conf" "$NGINX_SITE"; then
    cp "$NGINX_SITE" "$NGINX_SITE.bak-$(date +%Y%m%d-%H%M%S)"
    # Se incluye en cada bloque server del dominio principal (http y https).
    sed -i "s|^\(\s*\)server_name ${DOMAIN};|&\n\1include snippets/fantasylive-storage.conf;|" "$NGINX_SITE"
  fi
  if ! nginx -t; then
    echo "ERROR: la configuracion de nginx no es valida; no se ha recargado." >&2
    echo "Restaura la copia $NGINX_SITE.bak-* si hace falta." >&2
    exit 1
  fi
  systemctl reload nginx

  # --- 6. Variables de la app -----------------------------------------------
  if [[ -n "$app_key" ]]; then
    echo "==> Escribiendo S3_* en $APP_DIR/.env"
    cp "$APP_DIR/.env" "$APP_DIR/.env.bak-$(date +%Y%m%d-%H%M%S)"
    # Se quitan las S3_* anteriores y se anaden las nuevas al final.
    sed -i '/^S3_\(ENDPOINT\|REGION\|BUCKET\|ACCESS_KEY_ID\|SECRET_ACCESS_KEY\|FORCE_PATH_STYLE\|PUBLIC_BASE_URL\)=/d' "$APP_DIR/.env"
    cat >> "$APP_DIR/.env" <<EOF

# Almacenamiento propio (MinIO), configurado por deploy/setup-storage.sh
S3_ENDPOINT="${APP_URL}"
S3_REGION="us-east-1"
S3_BUCKET="${BUCKET}"
S3_ACCESS_KEY_ID="${app_key}"
S3_SECRET_ACCESS_KEY="${app_secret}"
S3_FORCE_PATH_STYLE="true"
# Sin S3_PUBLIC_BASE_URL a proposito: con el, las fotos de perfil apuntarian
# directo al bucket (privado salvo previews/) y darian 403. Sin el, la app las
# sirve por /api/public-media, que firma la URL.
S3_PUBLIC_BASE_URL=""
EOF
    chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
  fi

  echo "==> Reiniciando $SERVICE"
  systemctl restart "$SERVICE"

  # --- Comprobacion ----------------------------------------------------------
  # Pedir la raiz del bucket sin firma debe dar un AccessDenied de MinIO (XML):
  # eso demuestra que la ruta llega a MinIO y que el bucket no es publico.
  echo "==> Comprobando"
  sleep 3
  if curl -s --max-time 10 "${APP_URL}/${BUCKET}/" | grep -q "AccessDenied"; then
    echo "OK: el almacenamiento responde en ${APP_URL}/${BUCKET}/ (y es privado)."
  else
    echo "AVISO: ${APP_URL}/${BUCKET}/ no responde como se esperaba. Revisa: nginx -t" >&2
  fi
  echo
  echo "Listo. Prueba a subir una foto de perfil en la web."
  echo "Copia de seguridad: incluye /var/lib/minio en tus backups (son los archivos de tus usuarios)."
}

main "$@"
