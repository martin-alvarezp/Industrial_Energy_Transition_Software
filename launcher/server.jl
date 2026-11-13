# Punto de entrada del programa de escritorio: un solo proceso que sirve la
# API HiGHS y la UI compilada (frontend/dist) en http://127.0.0.1:8080.
# Lo lanza launcher/IETO.ps1; siempre corre el código actual del repo, así
# que actualizar el producto = volver a correr launcher/install.ps1.

using IETO

const ROOT = normpath(joinpath(@__DIR__, ".."))

# IETO_DATA_DIR / IETO_PORT: las pruebas (verify:all) corren sobre una COPIA de
# los sitios y en otro puerto — nunca escriben en data/sample_sites
server = start_server(
    port = parse(Int, get(ENV, "IETO_PORT", "8080")),
    data_dir = get(ENV, "IETO_DATA_DIR", joinpath(ROOT, "data", "sample_sites")),
    static_dir = joinpath(ROOT, "frontend", "dist"),
)
wait(server.serve_task)
