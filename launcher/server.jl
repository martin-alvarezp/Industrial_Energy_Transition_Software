# Punto de entrada del programa de escritorio: un solo proceso que sirve la
# API HiGHS y la UI compilada (frontend/dist) en http://127.0.0.1:8080.
# Lo lanza launcher/IETO.ps1; siempre corre el código actual del repo, así
# que actualizar el producto = volver a correr launcher/install.ps1.

using IETO

const ROOT = normpath(joinpath(@__DIR__, ".."))

server = start_server(
    port = 8080,
    data_dir = joinpath(ROOT, "data", "sample_sites"),
    static_dir = joinpath(ROOT, "frontend", "dist"),
)
wait(server.serve_task)
