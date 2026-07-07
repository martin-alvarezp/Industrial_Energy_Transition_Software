# Construye el EJECUTABLE PORTABLE de IETO (docs: correr con
#   julia --project=build build/build_app.jl
# tarda 20-40 min la primera vez). Salida: build/IETO-app/ lista para zipear.
using PackageCompiler

root = normpath(joinpath(@__DIR__, ".."))
dest = joinpath(root, "build", "IETO-app")

# prerequisito: la UI compilada
isdir(joinpath(root, "frontend", "dist")) ||
    error("falta frontend/dist — corre `npm run build` en frontend/ primero")

@info "create_app → $dest (esto tarda; deja la ventana abierta)"
create_app(root, dest;
           executables = ["IETO" => "julia_main"],
           precompile_execution_file = joinpath(@__DIR__, "precompile_app.jl"),
           include_lazy_artifacts = true,
           force = true)

# assets que julia_main busca en <app>/share/ieto
share = joinpath(dest, "share", "ieto")
mkpath(share)
cp(joinpath(root, "frontend", "dist"), joinpath(share, "dist"); force = true)
cp(joinpath(root, "data", "sample_sites"), joinpath(share, "sites"); force = true)
cp(joinpath(root, "launcher", "ieto.ico"), joinpath(share, "ieto.ico"); force = true)

# README del zip
write(joinpath(dest, "LEEME.txt"), """
IETO · Industrial Energy Transition Optimizer (portable)

1. Descomprime esta carpeta donde quieras.
2. Doble click en bin\\IETO.exe — se abre en tu navegador.
3. Tus sitios y corridas se guardan en %LOCALAPPDATA%\\IETO\\data.

La ventana de consola es el servidor: ciérrala para detener IETO.
Puerto alternativo: define la variable de entorno IETO_PORT.
""")

@info "listo — zipea build/IETO-app como IETO-win64.zip"
