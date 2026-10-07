#!/usr/bin/env bash
#############################################################################
# FantasyLive - descarga la lista de rangos IPv4 de servicios VPN
#
# La usa el bloqueo por paises (src/lib/vpn.ts): a quien entra por VPN no se
# le muestran los perfiles que bloquean algun pais. Fuente publica:
# https://github.com/X4BNet/lists_vpn (solo VPN, no centros de datos).
#
# La app relee el fichero sola (cada 10 min si cambio). Si la descarga falla
# o llega rara, se conserva la lista anterior.
#############################################################################
set -euo pipefail

URL="${VPN_LIST_URL:-https://raw.githubusercontent.com/X4BNet/lists_vpn/main/output/vpn/ipv4.txt}"
DEST="${VPN_LIST_FILE:-/var/lib/fantasylive/vpn-ipv4.txt}"
TMP="$(mktemp)"
trap 'rm -f "$TMP"' EXIT

curl -fsSL --max-time 60 "$URL" -o "$TMP"

# Solo lineas tipo 1.2.3.0/24 y un minimo razonable: si no, algo fue mal.
LINES=$(grep -cE '^[0-9]{1,3}(\.[0-9]{1,3}){3}/[0-9]{1,2}$' "$TMP" || true)
if [[ "$LINES" -lt 1000 ]]; then
  echo "Lista VPN sospechosa ($LINES rangos): se mantiene la anterior." >&2
  exit 1
fi

mkdir -p "$(dirname "$DEST")"
install -m 0644 "$TMP" "$DEST.new"
mv -f "$DEST.new" "$DEST"
echo "Lista VPN actualizada: $LINES rangos en $DEST"
