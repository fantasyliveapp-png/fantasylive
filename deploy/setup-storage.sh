#!/usr/bin/env bash
#############################################################################
# FantasyLive - almacenamiento propio (SeaweedFS, compatible S3) en el mismo
# servidor
#
# Uso (como root en el servidor):
#   bash /var/www/fantasylive/deploy/setup-storage.sh https://tudominio.com
#
# Los archivos se sirven desde el MISMO dominio de la web, bajo
# https://tudominio.com/<bucket>/..., asi que no hace falta ningun registro
# DNS ni certificado nuevo: nginx pasa esa ruta al almacenamiento tal cual.
#
# Por que funciona sin reescribir nada: las URLs firmadas de S3 incluyen el
# host y la ruta en la firma. En modo "path style" la ruta ya empieza por el
# nombre del bucket, y nginx la entrega sin tocarla ni cambiar el Host, asi
# que la firma sigue siendo valida. Al ser el mismo origen que la web, el
# navegador sube sin necesitar CORS.
#
# Por que SeaweedFS y no MinIO: MinIO dejo de publicar sus binarios (la
# descarga devuelve 410). SeaweedFS es un unico binario, activo y compatible
# con S3; la app no nota la diferencia.
#
# Que hace:
#   1. Descarga SeaweedFS (version fija, comprobando su md5) si no esta.
#   2. Crea el usuario de servicio, /var/lib/seaweedfs y las credenciales de
#      la app en /etc/seaweedfs/s3.json (solo tienen acceso al bucket). Sin
#      identidad anonima: todo es privado y se sirve con URL firmada.
#   3. Arranca SeaweedFS escuchando solo en 127.0.0.1.
#   4. Crea el bucket.
#   5. Anade a la web de nginx la ruta /<bucket>/ hacia el almacenamiento.
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
  local WEED_VERSION="${WEED_VERSION:-4.47}"
  local S3_CONFIG=/etc/seaweedfs/s3.json
  local APP_KEY="fantasylive-app"
  local MASTER=127.0.0.1:19333
  local S3_LOCAL=http://127.0.0.1:18333

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

  # Restos de un intento anterior con MinIO (su descarga fallaba con 410).
  if [[ -f /usr/local/bin/minio && ! -s /usr/local/bin/minio ]]; then
    rm -f /usr/local/bin/minio
  fi

  # --- 1. Binario -----------------------------------------------------------
  local arch
  case "$(uname -m)" in
    x86_64) arch="amd64" ;;
    aarch64 | arm64) arch="arm64" ;;
    *) echo "ERROR: arquitectura no soportada: $(uname -m)" >&2; exit 1 ;;
  esac

  if [[ ! -x /usr/local/bin/weed ]] || ! /usr/local/bin/weed version 2>/dev/null | grep -q " ${WEED_VERSION} "; then
    echo "==> Instalando SeaweedFS ${WEED_VERSION}"
    local tmp base
    tmp="$(mktemp -d)"
    base="https://github.com/seaweedfs/seaweedfs/releases/download/${WEED_VERSION}/linux_${arch}.tar.gz"
    curl -fsSL "$base" -o "$tmp/linux_${arch}.tar.gz"
    curl -fsSL "$base.md5" -o "$tmp/linux_${arch}.tar.gz.md5"
    if [[ "$(md5sum "$tmp/linux_${arch}.tar.gz" | cut -d' ' -f1)" != "$(grep -oE '[0-9a-f]{32}' "$tmp/linux_${arch}.tar.gz.md5" | head -1)" ]]; then
      echo "ERROR: el md5 de la descarga no coincide. No se instala nada." >&2
      rm -rf "$tmp"
      exit 1
    fi
    tar -xzf "$tmp/linux_${arch}.tar.gz" -C "$tmp" weed
    install -m 0755 "$tmp/weed" /usr/local/bin/weed
    rm -rf "$tmp"
  fi

  # --- 2. Usuario, datos y credenciales -------------------------------------
  if ! id seaweedfs >/dev/null 2>&1; then
    useradd --system --no-create-home --shell /usr/sbin/nologin seaweedfs
  fi
  mkdir -p /var/lib/seaweedfs /etc/seaweedfs
  chown seaweedfs:seaweedfs /var/lib/seaweedfs

  local app_secret
  if [[ -f "$S3_CONFIG" ]]; then
    app_secret="$(grep -oE '"secretKey": *"[^"]+"' "$S3_CONFIG" | head -1 | sed -E 's/.*"([^"]+)"$/\1/' || true)"
  fi
  if [[ -z "${app_secret:-}" ]]; then
    echo "==> Generando las credenciales de la app"
    app_secret="$(openssl rand -hex 24)"
    umask 077
    cat > "$S3_CONFIG" <<EOF
{
  "identities": [
    {
      "name": "${APP_KEY}",
      "credentials": [{ "accessKey": "${APP_KEY}", "secretKey": "${app_secret}" }],
      "actions": [
        "Read:${BUCKET}",
        "Write:${BUCKET}",
        "List:${BUCKET}",
        "Tagging:${BUCKET}"
      ]
    }
  ]
}
EOF
    umask 022
  fi
  chown root:seaweedfs "$S3_CONFIG"
  chmod 640 "$S3_CONFIG"

  # --- 3. Servicio ----------------------------------------------------------
  echo "==> Arrancando SeaweedFS"
  cp "$APP_DIR/deploy/seaweedfs.service" /etc/systemd/system/seaweedfs.service
  systemctl daemon-reload
  systemctl enable seaweedfs >/dev/null 2>&1
  systemctl restart seaweedfs

  local i ready=""
  for i in $(seq 1 60); do
    if curl -s -o /dev/null --max-time 2 "$S3_LOCAL/"; then
      ready=1
      break
    fi
    sleep 1
  done
  if [[ -z "$ready" ]]; then
    echo "ERROR: SeaweedFS no arranca. Revisa: journalctl -u seaweedfs -n 80 --no-pager" >&2
    exit 1
  fi
  sleep 3

  # --- 4. Bucket ------------------------------------------------------------
  echo "==> Configurando el bucket $BUCKET"
  # Tras arrancar, el puerto S3 responde antes que el filer: se reintenta
  # hasta ver el bucket en la lista, en vez de dar por buena la primera vez.
  local bucket_ok=""
  for i in $(seq 1 30); do
    if echo "s3.bucket.list" | timeout 20 weed shell -master="$MASTER" 2>/dev/null | grep -qw "$BUCKET"; then
      bucket_ok=1
      break
    fi
    echo "s3.bucket.create -name $BUCKET" | timeout 20 weed shell -master="$MASTER" >/dev/null 2>&1 || true
    sleep 2
  done
  if [[ -z "$bucket_ok" ]]; then
    echo "ERROR: no se pudo crear el bucket $BUCKET. Revisa: journalctl -u seaweedfs -n 80 --no-pager" >&2
    exit 1
  fi
  echo "    Bucket $BUCKET listo."

  # --- 5. nginx: /<bucket>/ -> almacenamiento en la web existente -----------
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
  if ! grep -q "^S3_ACCESS_KEY_ID=\"${APP_KEY}\"" "$APP_DIR/.env" \
    || ! grep -q "^S3_SECRET_ACCESS_KEY=\"${app_secret}\"" "$APP_DIR/.env" \
    || ! grep -q "^S3_ENDPOINT=\"${APP_URL}\"" "$APP_DIR/.env"; then
    echo "==> Escribiendo S3_* en $APP_DIR/.env"
    cp "$APP_DIR/.env" "$APP_DIR/.env.bak-$(date +%Y%m%d-%H%M%S)"
    # Se quitan las S3_* anteriores y se anaden las nuevas al final.
    sed -i '/^S3_\(ENDPOINT\|REGION\|BUCKET\|ACCESS_KEY_ID\|SECRET_ACCESS_KEY\|FORCE_PATH_STYLE\|PUBLIC_BASE_URL\)=/d' "$APP_DIR/.env"
    cat >> "$APP_DIR/.env" <<EOF

# Almacenamiento propio (SeaweedFS), configurado por deploy/setup-storage.sh
S3_ENDPOINT="${APP_URL}"
S3_REGION="us-east-1"
S3_BUCKET="${BUCKET}"
S3_ACCESS_KEY_ID="${APP_KEY}"
S3_SECRET_ACCESS_KEY="${app_secret}"
S3_FORCE_PATH_STYLE="true"
# Sin S3_PUBLIC_BASE_URL a proposito: con el, las fotos de perfil apuntarian
# directo al bucket (privado) y darian 403. Sin el, la app las sirve por
# /api/public-media, que firma la URL.
S3_PUBLIC_BASE_URL=""
EOF
    chown "$APP_USER":"$APP_USER" "$APP_DIR/.env"
    chmod 600 "$APP_DIR/.env"
  fi

  echo "==> Reiniciando $SERVICE"
  systemctl restart "$SERVICE"

  # --- Comprobacion ----------------------------------------------------------
  # Pedir la raiz del bucket sin firma debe dar AccessDenied: eso demuestra que
  # la ruta llega al almacenamiento y que el bucket no es publico.
  echo "==> Comprobando"
  sleep 3
  if curl -s --max-time 10 "${APP_URL}/${BUCKET}/" | grep -q "AccessDenied"; then
    echo "OK: el almacenamiento responde en ${APP_URL}/${BUCKET}/ (y es privado)."
  else
    echo "AVISO: ${APP_URL}/${BUCKET}/ no responde como se esperaba. Revisa: nginx -t y journalctl -u seaweedfs" >&2
  fi
  echo
  echo "Listo. Prueba a subir una foto de perfil en la web."
  echo "Copia de seguridad: incluye /var/lib/seaweedfs en tus backups (son los archivos de tus usuarios)."
}

main "$@"
