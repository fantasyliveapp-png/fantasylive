#!/usr/bin/env bash
#############################################################################
# FantasyLive - almacenamiento propio (MinIO) en el mismo servidor
#
# Uso (como root en el servidor):
#   bash /var/www/fantasylive/deploy/setup-storage.sh files.tudominio.com https://tudominio.com
#
#   1er argumento: subdominio para los archivos (debe tener ya su registro
#                  DNS A apuntando a este servidor).
#   2o argumento:  direccion de la web, desde la que los navegadores suben
#                  las fotos (CORS).
#
# Que hace:
#   1. Instala MinIO y su cliente (mc) si no estan.
#   2. Crea el usuario de servicio, /var/lib/minio y /etc/default/minio con
#      unas credenciales de administrador aleatorias (solo root las lee).
#   3. Arranca MinIO escuchando solo en 127.0.0.1.
#   4. Crea el bucket, deja publica solo la carpeta previews/ (miniaturas
#      borrosas) y crea un usuario solo para la app, distinto del admin.
#   5. Publica el subdominio en nginx y pide el certificado HTTPS.
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
  local STORAGE_NAME="${1:-}"
  local APP_ORIGIN="${2:-}"
  local APP_DIR="${APP_DIR:-/var/www/fantasylive}"
  local APP_USER="${APP_USER:-fantasylive}"
  local SERVICE="${SERVICE:-fantasylive}"
  local BUCKET="${BUCKET:-fantasylive-content}"
  local APP_S3_USER="fantasylive-app"

  if [[ -z "$STORAGE_NAME" || -z "$APP_ORIGIN" ]]; then
    echo "Uso: bash $0 files.tudominio.com https://tudominio.com" >&2
    exit 1
  fi
  if [[ "$APP_ORIGIN" != https://* ]]; then
    echo "ERROR: la web debe ir con https:// (p. ej. https://tudominio.com)." >&2
    exit 1
  fi
  if [[ $EUID -ne 0 ]]; then
    echo "ERROR: ejecutalo como root (sudo)." >&2
    exit 1
  fi
  if [[ ! -f "$APP_DIR/.env" ]]; then
    echo "ERROR: no encuentro $APP_DIR/.env." >&2
    exit 1
  fi

  echo "==> Comprobando el DNS de $STORAGE_NAME"
  if ! getent hosts "$STORAGE_NAME" >/dev/null; then
    echo "ERROR: $STORAGE_NAME no resuelve. Crea antes el registro DNS A hacia este servidor." >&2
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
# Direccion publica: las URLs firmadas se generan contra ella.
MINIO_SERVER_URL=https://${STORAGE_NAME}
# Solo la web puede subir desde el navegador.
MINIO_API_CORS_ALLOW_ORIGIN=${APP_ORIGIN}
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

  local app_key app_secret
  if grep -q "^S3_ENDPOINT=\"https://${STORAGE_NAME}\"" "$APP_DIR/.env" \
    && mc admin user info fl-local "$APP_S3_USER" >/dev/null 2>&1; then
    echo "    La app ya tiene sus credenciales: no se cambian."
    app_key=""
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

  # --- 5. nginx + HTTPS ------------------------------------------------------
  echo "==> Publicando https://$STORAGE_NAME"
  sed "s/__STORAGE_NAME__/${STORAGE_NAME}/g" "$APP_DIR/deploy/nginx-storage.conf" \
    > /etc/nginx/sites-available/fantasylive-storage
  ln -sf /etc/nginx/sites-available/fantasylive-storage /etc/nginx/sites-enabled/
  nginx -t
  systemctl reload nginx

  if [[ ! -d "/etc/letsencrypt/live/${STORAGE_NAME}" ]]; then
    certbot --nginx -d "$STORAGE_NAME" --redirect
  else
    echo "    El certificado de $STORAGE_NAME ya existe."
  fi

  # --- 6. Variables de la app -----------------------------------------------
  if [[ -n "$app_key" ]]; then
    echo "==> Escribiendo S3_* en $APP_DIR/.env"
    cp "$APP_DIR/.env" "$APP_DIR/.env.bak-$(date +%Y%m%d-%H%M%S)"
    # Se quitan las S3_* anteriores y se anaden las nuevas al final.
    sed -i '/^S3_\(ENDPOINT\|REGION\|BUCKET\|ACCESS_KEY_ID\|SECRET_ACCESS_KEY\|FORCE_PATH_STYLE\|PUBLIC_BASE_URL\)=/d' "$APP_DIR/.env"
    cat >> "$APP_DIR/.env" <<EOF

# Almacenamiento propio (MinIO), configurado por deploy/setup-storage.sh
S3_ENDPOINT="https://${STORAGE_NAME}"
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

  echo "==> Comprobando"
  if curl -fsS --max-time 5 "https://${STORAGE_NAME}/minio/health/live" >/dev/null; then
    echo "OK: el almacenamiento responde en https://${STORAGE_NAME}"
  else
    echo "AVISO: https://${STORAGE_NAME} no responde todavia. Revisa el DNS y: nginx -t" >&2
  fi
  echo
  echo "Listo. Prueba a subir una foto de perfil en la web."
  echo "Copia de seguridad: incluye /var/lib/minio en tus backups (son los archivos de tus usuarios)."
}

main "$@"
