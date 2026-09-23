#!/bin/bash
##############################################################################
# Genera /etc/nginx/conf.d/cloudflare.conf a partir de los rangos publicados
# por Cloudflare.
#
# Hace dos cosas, ambas necesarias cuando el dominio esta proxiado por CF:
#
#  1. IP REAL DEL VISITANTE. Sin esto, para nginx todo el trafico viene de
#     Cloudflare y el GeoIP de respaldo geolocalizaria a los servidores de CF
#     en vez de a la persona.
#
#  2. CONFIANZA EN CF-IPCountry. La cabecera de pais de Cloudflare solo se
#     reenvia a la app cuando la conexion viene DE VERDAD de una IP de
#     Cloudflare. Quien ataque directamente a la IP del origen con una
#     CF-IPCountry falsa recibe cadena vacia, y la app cae al GeoIP local.
#     Sin esta comprobacion, el bloqueo por pais se saltaria con curl -H.
#
# Ejecutar tras cada cambio de rangos (Cloudflare los actualiza rara vez):
#   sudo bash deploy/cloudflare-realip.sh && sudo systemctl reload nginx
##############################################################################
set -euo pipefail

OUT=/etc/nginx/conf.d/cloudflare.conf
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

fetch_ranges() {
  curl -fsS --max-time 20 "https://www.cloudflare.com/ips-v4"
  echo
  curl -fsS --max-time 20 "https://www.cloudflare.com/ips-v6"
  echo
}

RANGES="$(fetch_ranges | grep -E '^[0-9a-fA-F:.]+/[0-9]+$' || true)"
COUNT="$(printf '%s\n' "$RANGES" | grep -c . || true)"

if [ "${COUNT:-0}" -lt 10 ]; then
  echo "ERROR: solo se obtuvieron ${COUNT:-0} rangos de Cloudflare; se esperaban >=10." >&2
  echo "No se toca $OUT para no dejar nginx sin la lista correcta." >&2
  exit 1
fi

{
  echo "# Generado por deploy/cloudflare-realip.sh el $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "# NO editar a mano: se regenera entero."
  echo

  echo "# --- 1. IP real del visitante ---"
  printf '%s\n' "$RANGES" | sed 's/^/set_real_ip_from /; s/$/;/'
  echo "real_ip_header CF-Connecting-IP;"
  echo

  echo "# --- 2. Solo se confia en CF-IPCountry si la conexion viene de Cloudflare ---"
  echo "# geo usa \$realip_remote_addr: la IP del par TCP ANTES de la"
  echo "# sustitucion de real_ip, es decir, quien conecto de verdad."
  echo "geo \$realip_remote_addr \$desde_cloudflare {"
  echo "    default 0;"
  printf '%s\n' "$RANGES" | sed 's/^/    /; s/$/ 1;/'
  echo "}"
  echo
  echo "map \$desde_cloudflare \$cf_country {"
  echo "    1 \$http_cf_ipcountry;  # viene de Cloudflare: fiable"
  echo "    0 \"\";                 # acceso directo al origen: se descarta"
  echo "}"
} > "$TMP"

install -m 644 "$TMP" "$OUT"

if ! nginx -t; then
  echo "ERROR: la configuracion generada no valida. Revisa $OUT" >&2
  exit 1
fi

echo "OK: $OUT con $COUNT rangos de Cloudflare."
echo "Recarga con: systemctl reload nginx"
