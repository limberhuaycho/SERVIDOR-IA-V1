<#
  instalar-entorno.ps1
  Prepara el equipo para trabajar en local:
    1. Comprueba Node.js, pnpm y Python.
    2. Instala las dependencias del frontend y del backend.
    3. Instala las dependencias Python del motor media-dl.
    4. Comprueba ffmpeg (necesario para convertir a MP3 y fusionar video).

  Uso:  powershell -ExecutionPolicy Bypass -File .\instalar-entorno.ps1
#>

$ErrorActionPreference = 'Stop'
$raiz = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $raiz

function Info($msg)  { Write-Host "==> $msg" -ForegroundColor Cyan }
function Ok($msg)    { Write-Host "    [OK] $msg" -ForegroundColor Green }
function Aviso($msg) { Write-Host "    [!] $msg"  -ForegroundColor Yellow }

# ---------------------------------------------------------------- Node / pnpm
Info "Comprobando Node.js..."
if (Get-Command node -ErrorAction SilentlyContinue) {
    Ok "Node $(node --version)"
} else {
    Aviso "Node.js no esta en el PATH."
    Aviso "Instala la version LTS 24 desde https://nodejs.org y vuelve a abrir la terminal."
    exit 1
}

if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Info "Instalando pnpm 9.15.9 (la version que usa el workflow de GitHub)..."
    & npm.cmd install -g pnpm@9.15.9
}
Ok "pnpm $(pnpm --version)"

# ------------------------------------------------------------------- Frontend
Info "Instalando dependencias del frontend (pnpm install)..."
& pnpm.cmd install
if ($LASTEXITCODE -ne 0) { Aviso "Fallo pnpm install en el frontend."; exit 1 }
Ok "Frontend listo"

# --------------------------------------------------------------------- Backend
Info "Instalando dependencias del backend (npm install en server\)..."
Push-Location (Join-Path $raiz 'server')
& npm.cmd install
Pop-Location
Ok "Backend listo"

# ---------------------------------------------------------------------- Python
Info "Comprobando Python..."
$python = $null
foreach ($candidato in @('python', 'py')) {
    $cmd = Get-Command $candidato -ErrorAction SilentlyContinue
    if (-not $cmd) { continue }
    # El alias de la Microsoft Store existe pero no ejecuta nada.
    $salida = & $candidato --version 2>&1
    if ($salida -match '^Python\s*\d') { $python = $candidato; break }
}

if (-not $python) {
    Aviso "No se encontro Python 3.11 o superior."
    Aviso "Instalalo desde https://www.python.org/downloads/ y marca 'Add to PATH'."
    exit 1
}
Ok "Python $($python -replace '.*\\', '') -> $(& $python --version)"

Info "Instalando dependencias Python del motor media-dl..."
& $python -m pip install --upgrade pip --quiet
& $python -m pip install -e (Join-Path $raiz 'media-dl') --quiet
& $python -m pip install yt-dlp --upgrade --quiet
Ok "Motor media-dl instalado"

# --------------------------------------------------------------------- ffmpeg
Info "Comprobando ffmpeg..."
if (Get-Command ffmpeg -ErrorAction SilentlyContinue) {
    Ok "ffmpeg disponible (MP3 y fusion de video activados)"
} else {
    Aviso "ffmpeg NO esta instalado."
    Aviso "Sin el, el video de YouTube no se puede fusionar y el MP3 no se convierte."
    Aviso "Instala con:  winget install Gyan.FFmpeg"
}

Write-Host ""
Write-Host "==================================================" -ForegroundColor Green
Write-Host " ENTORNO LISTO" -ForegroundColor Green
Write-Host "==================================================" -ForegroundColor Green
Write-Host ""
Write-Host " Para levantar la aplicacion abre DOS terminales:"
Write-Host ""
Write-Host "   Terminal 1 (frontend):"
Write-Host "     pnpm dev            -> http://localhost:5173/SERVIDOR-IA-V1/"
Write-Host ""
Write-Host "   Terminal 2 (backend):"
Write-Host "     cd server"
Write-Host "     npm start           -> http://localhost:4000"
Write-Host ""
Write-Host " En la web, Ajustes > Servidor Backend debe decir http://localhost:4000"
Write-Host ""
