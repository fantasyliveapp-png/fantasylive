# =============================================================================
# Inicializa el repositorio Git y lo sube a GitHub (Windows / PowerShell)
#
#   .\scripts\init-git.ps1 -RepoName fantasylive -Private
#
# Requiere GitHub CLI: https://cli.github.com  (o usa el modo manual del final)
# =============================================================================

param(
    [string]$RepoName = "fantasylive",
    [switch]$Private,
    [string]$Branch = "main"
)

$ErrorActionPreference = "Stop"

Write-Host "== FantasyLive :: preparacion de Git ==" -ForegroundColor Magenta

# 1. Comprobacion de seguridad: el .env NUNCA debe subirse
if (Test-Path ".env") {
    $ignored = git check-ignore .env 2>$null
    if (-not $ignored) {
        Write-Host "ERROR: .env no esta siendo ignorado por git. Revisa .gitignore antes de continuar." -ForegroundColor Red
        exit 1
    }
    Write-Host "OK: .env esta correctamente ignorado." -ForegroundColor Green
}

# 2. Inicializar repo
if (-not (Test-Path ".git")) {
    git init
    git branch -M $Branch
    Write-Host "Repositorio inicializado en la rama '$Branch'." -ForegroundColor Green
} else {
    Write-Host "El repositorio ya existe, se reutiliza." -ForegroundColor Yellow
}

# 3. Primer commit
git add -A
$hasCommits = git rev-parse --verify HEAD 2>$null
if ($LASTEXITCODE -ne 0) {
    git commit -m "chore: scaffold inicial de FantasyLive (Next.js + Prisma + LiveKit)"
    Write-Host "Commit inicial creado." -ForegroundColor Green
} else {
    git commit -m "chore: actualizacion del proyecto" 2>$null
    Write-Host "Cambios commiteados (si los habia)." -ForegroundColor Green
}

# 4. Crear el repo remoto con GitHub CLI
$gh = Get-Command gh -ErrorAction SilentlyContinue
if ($gh) {
    $visibility = if ($Private) { "--private" } else { "--public" }
    Write-Host "Creando repositorio en GitHub..." -ForegroundColor Cyan
    gh repo create $RepoName $visibility --source=. --remote=origin --push
    Write-Host "Listo. Repositorio publicado." -ForegroundColor Green
} else {
    Write-Host ""
    Write-Host "GitHub CLI no esta instalado. Pasos manuales:" -ForegroundColor Yellow
    Write-Host "  1) Crea el repo vacio en https://github.com/new (nombre: $RepoName)"
    Write-Host "  2) Ejecuta:"
    Write-Host "       git remote add origin https://github.com/<TU_USUARIO>/$RepoName.git"
    Write-Host "       git push -u origin $Branch"
}
