# Instalador / actualizador de IETO como programa de escritorio (Windows).
# Correlo tras clonar el repo Y cada vez que haya cambios en el producto:
#   powershell -ExecutionPolicy Bypass -File launcher\install.ps1
# Hace: dependencias Julia + build del frontend + icono + accesos directos.

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $PSScriptRoot
Write-Host "IETO · instalando/actualizando desde $root" -ForegroundColor Cyan

# ── herramientas ──
$env:Path = [Environment]::GetEnvironmentVariable("Path", "Machine") + ";" +
            [Environment]::GetEnvironmentVariable("Path", "User")
function Get-Julia {
    $cmd = Get-Command julia -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $found = Get-ChildItem "$env:LOCALAPPDATA\Programs\Julia-*\bin\julia.exe" `
        -ErrorAction SilentlyContinue | Sort-Object FullName -Descending |
        Select-Object -First 1
    if ($found) { return $found.FullName }
    throw "Julia no encontrado: instala Julia 1.10+ (https://julialang.org)"
}
$julia = Get-Julia
$npm = Get-Command npm -ErrorAction SilentlyContinue
if (-not $npm) { throw "npm no encontrado: instala Node.js 18+ (https://nodejs.org)" }

# ── 1 · backend: dependencias y precompilación (arranques rápidos) ──
Write-Host "[1/4] dependencias Julia + precompilación…" -ForegroundColor Cyan
& $julia --project="$root" -e "using Pkg; Pkg.instantiate(); Pkg.precompile()"
if ($LASTEXITCODE -ne 0) { throw "falló la preparación del backend" }

# ── 2 · frontend: build de producción (lo sirve el propio backend) ──
Write-Host "[2/4] build del frontend…" -ForegroundColor Cyan
Push-Location "$root\frontend"
try {
    if (-not (Test-Path "node_modules")) { npm install --no-fund --no-audit }
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "falló el build del frontend" }
} finally { Pop-Location }

# ── 3 · icono (teal con rayo, generado localmente) ──
Write-Host "[3/4] icono…" -ForegroundColor Cyan
$icoPath = "$root\launcher\ieto.ico"
if (-not (Test-Path $icoPath)) {
    Add-Type -AssemblyName System.Drawing
    $size = 256
    $bmp = New-Object System.Drawing.Bitmap $size, $size
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)

    $rect = New-Object System.Drawing.Rectangle 8, 8, ($size - 16), ($size - 16)
    $bg = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        $rect, [System.Drawing.ColorTranslator]::FromHtml("#0b3d38"),
        [System.Drawing.ColorTranslator]::FromHtml("#008165"), 45)
    $path = New-Object System.Drawing.Drawing2D.GraphicsPath
    $r = 52; $x = $rect.X; $y = $rect.Y; $w = $rect.Width; $h = $rect.Height
    $path.AddArc($x, $y, $r, $r, 180, 90)
    $path.AddArc($x + $w - $r, $y, $r, $r, 270, 90)
    $path.AddArc($x + $w - $r, $y + $h - $r, $r, $r, 0, 90)
    $path.AddArc($x, $y + $h - $r, $r, $r, 90, 90)
    $path.CloseFigure()
    $g.FillPath($bg, $path)

    $bolt = [System.Drawing.PointF[]]@(
        (New-Object System.Drawing.PointF 152, 34),
        (New-Object System.Drawing.PointF 76, 150),
        (New-Object System.Drawing.PointF 124, 150),
        (New-Object System.Drawing.PointF 106, 224),
        (New-Object System.Drawing.PointF 184, 106),
        (New-Object System.Drawing.PointF 134, 106)
    )
    $g.FillPolygon([System.Drawing.Brushes]::White, $bolt)
    $g.Dispose()

    # ICO moderno: contenedor con el PNG embebido (soportado desde Vista)
    $ms = New-Object System.IO.MemoryStream
    $bmp.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
    $png = $ms.ToArray()
    $fs = [System.IO.File]::Create($icoPath)
    $bw = New-Object System.IO.BinaryWriter $fs
    $bw.Write([byte[]]@(0,0, 1,0, 1,0))                # header: tipo icono, 1 imagen
    $bw.Write([byte[]]@(0, 0, 0, 0, 1,0, 32,0))       # 256x256, 32bpp
    $bw.Write([int]$png.Length); $bw.Write([int]22)   # tamaño + offset
    $bw.Write($png); $bw.Close()
    Write-Host "  icono generado: $icoPath"
} else { Write-Host "  icono existente: $icoPath" }

# ── 4 · accesos directos del Escritorio ──
Write-Host "[4/4] accesos directos…" -ForegroundColor Cyan
$desktop = [Environment]::GetFolderPath("Desktop")
$shell = New-Object -ComObject WScript.Shell

$lnk = $shell.CreateShortcut("$desktop\IETO.lnk")
$lnk.TargetPath = "$env:WINDIR\System32\wscript.exe"
$lnk.Arguments = "`"$root\launcher\IETO.vbs`""
$lnk.WorkingDirectory = $root
$lnk.IconLocation = $icoPath
$lnk.Description = "IETO · Executive Cockpit — optimizador de transición energética"
$lnk.Save()

$upd = $shell.CreateShortcut("$desktop\IETO (actualizar).lnk")
$upd.TargetPath = "powershell.exe"
$upd.Arguments = "-NoProfile -ExecutionPolicy Bypass -File `"$root\launcher\install.ps1`""
$upd.WorkingDirectory = $root
$upd.IconLocation = $icoPath
$upd.Description = "Reconstruye IETO tras una actualización del producto"
$upd.Save()

Write-Host ""
Write-Host "Listo. En el Escritorio:" -ForegroundColor Green
Write-Host "  · IETO              → abre el programa (doble click)"
Write-Host "  · IETO (actualizar) → correr tras cada actualización del código"
Write-Host "Para detener el motor: launcher\Detener-IETO.ps1"
