# Entrypoint del EJECUTABLE PORTABLE (PackageCompiler.create_app):
# un proceso que sirve API + UI y abre el navegador. Los datos del usuario
# (sitios y corridas) viven en %LOCALAPPDATA%\IETO — el zip del app puede
# quedar en una carpeta de solo lectura.

"""
    julia_main() -> Cint

Arranca IETO como aplicación de escritorio compilada:
1. localiza los assets empaquetados (`<app>/share/ieto/{dist,sites}`),
2. siembra los datos escribibles del usuario en LOCALAPPDATA la primera vez,
3. sirve API + UI en `http://127.0.0.1:\$IETO_PORT` (default 8080) y abre el
   navegador. Bloquea hasta cerrar la consola.
"""
function julia_main()::Cint
    try
        app_root = normpath(joinpath(Sys.BINDIR, ".."))
        share = joinpath(app_root, "share", "ieto")
        static = joinpath(share, "dist")
        seed = joinpath(share, "sites")
        isdir(static) || error("no encuentro la UI empaquetada en $static")
        isdir(seed) || error("no encuentro los sitios de ejemplo en $seed")

        base = get(ENV, "LOCALAPPDATA", joinpath(homedir(), ".ieto"))
        udata = joinpath(base, "IETO", "data")
        sites = joinpath(udata, "sample_sites")
        if !isdir(sites)
            mkpath(udata)
            cp(seed, sites)
            @info "primera ejecución: sitios de ejemplo copiados a $sites"
        end

        port = something(tryparse(Int, get(ENV, "IETO_PORT", "")), 8080)
        server = start_server(; port, data_dir = sites, static_dir = static)
        url = "http://127.0.0.1:$port/"
        @info "IETO listo en $url — cierra esta ventana para detenerlo"
        try
            Sys.iswindows() && run(`cmd /c start "" $url`; wait = false)
        catch
        end
        wait(server.serve_task)
    catch e
        @error "IETO terminó con error" exception = (e, catch_backtrace())
        println("\nPresiona Enter para cerrar…")
        readline()
        return 1
    end
    return 0
end
