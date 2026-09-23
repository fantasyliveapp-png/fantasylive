#!/usr/bin/env bash
# =============================================================================
# Inicializa el repositorio Git y lo sube a GitHub (Linux / macOS / Git Bash)
#
#   ./scripts/init-git.sh fantasylive private
#
# Requiere GitHub CLI (https://cli.github.com) para la creacion automatica.
# =============================================================================
set -euo pipefail

REPO_NAME="${1:-fantasylive}"
VISIBILITY="${2:-private}"
BRANCH="main"

echo "== FantasyLive :: preparacion de Git =="

# 1. El .env NUNCA debe subirse
if [ -f .env ]; then
  if ! git check-ignore -q .env 2>/dev/null; then
    echo "ERROR: .env no esta ignorado por git. Revisa .gitignore." >&2
    exit 1
  fi
  echo "OK: .env esta correctamente ignorado."
fi

# 2. Inicializar
if [ ! -d .git ]; then
  git init
  git branch -M "$BRANCH"
  echo "Repositorio inicializado en la rama '$BRANCH'."
else
  echo "El repositorio ya existe, se reutiliza."
fi

# 3. Commit
git add -A
if git rev-parse --verify HEAD >/dev/null 2>&1; then
  git commit -m "chore: actualizacion del proyecto" || echo "Sin cambios que commitear."
else
  git commit -m "chore: scaffold inicial de FantasyLive (Next.js + Prisma + LiveKit)"
fi

# 4. Publicar
if command -v gh >/dev/null 2>&1; then
  echo "Creando repositorio en GitHub..."
  gh repo create "$REPO_NAME" "--$VISIBILITY" --source=. --remote=origin --push
  echo "Listo. Repositorio publicado."
else
  cat <<EOF

GitHub CLI no esta instalado. Pasos manuales:
  1) Crea el repo vacio en https://github.com/new (nombre: $REPO_NAME)
  2) Ejecuta:
       git remote add origin https://github.com/<TU_USUARIO>/$REPO_NAME.git
       git push -u origin $BRANCH
EOF
fi
