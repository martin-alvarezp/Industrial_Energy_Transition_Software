# Detiene SOLO el servidor de IETO (el proceso julia que corre
# launcher\server.jl) sin tocar otras sesiones de Julia.
$procs = Get-CimInstance Win32_Process -Filter "Name = 'julia.exe'" |
    Where-Object { $_.CommandLine -match "launcher\\server\.jl" }
if ($procs) {
    $procs | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }
    Write-Host "IETO detenido ($($procs.Count) proceso(s))." -ForegroundColor Green
} else {
    Write-Host "IETO no estaba corriendo." -ForegroundColor Yellow
}
