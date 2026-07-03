# Lanzador de IETO Executive Cockpit (lo invoca IETO.vbs desde el acceso
# directo del Escritorio). Levanta el servidor si no está y abre la app en
# una ventana propia (Edge --app). Idempotente: si ya corre, solo abre la
# ventana.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
if ((Split-Path -Leaf $PSScriptRoot) -ne "launcher") { $root = $PSScriptRoot }
# bitácora del lanzador (diagnóstico cuando corre oculto)
$log = "$root\launcher\ieto-launcher.log"
function Log($msg) {
    Add-Content -Path $log -Value "$(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') $msg"
}
Log "── lanzador invocado (host: $($Host.Name))"
trap { Log "ERROR: $_"; break }

function Get-Julia {
    $cmd = Get-Command julia -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem "$env:LOCALAPPDATA\Programs\Julia-*\bin\julia.exe" `
        -ErrorAction SilentlyContinue | Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "No se encontró Julia. Instálala y vuelve a correr launcher\install.ps1"
}

function Test-Api {
    try {
        (Invoke-WebRequest "http://127.0.0.1:8080/scenarios" -UseBasicParsing `
            -TimeoutSec 2).StatusCode -eq 200
    } catch { $false }
}

if (-not (Test-Api)) {
    $julia = Get-Julia
    Log "iniciando servidor: $julia"
    # nota: Start-Process 5.1 une los argumentos sin re-quotear; el repo no
    # debe vivir en una ruta con espacios (documentado en el README)
    Start-Process $julia `
        -ArgumentList "--project=$root", "$root\launcher\server.jl" `
        -WindowStyle Hidden -WorkingDirectory $root
} else {
    Log "servidor ya corriendo"
}

# ventana de la app: página de arranque local que espera la API y redirige
$startPage = "file:///" + (($root -replace "\\", "/") + "/launcher/starting.html")
$edge = @(
    "$env:ProgramFiles (x86)\Microsoft\Edge\Application\msedge.exe",
    "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
    "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe"
) | Where-Object { Test-Path $_ } | Select-Object -First 1

if ($edge) {
    Log "abriendo ventana de app: $edge"
    Start-Process $edge -ArgumentList "--app=$startPage"
} else {
    # sin Edge: navegador por defecto directo a la app (sin página de arranque)
    for ($i = 0; $i -lt 60; $i++) { if (Test-Api) { break }; Start-Sleep -Seconds 2 }
    Start-Process "http://127.0.0.1:8080/"
}
Log "listo"
