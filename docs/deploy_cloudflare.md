# IETO en Cloudflare Pages con acceso por correo (WP-10)

Objetivo: que la versión web solo la abran las personas autorizadas, a costo
cero y sin montar un servidor.

- Pocas personas (≤ 10): el plan gratis de Cloudflare Zero Trust cubre hasta
  50 usuarios.
- Quien administra agrega o quita correos desde el panel de Cloudflare.
- Para entrar no hace falta crear una cuenta: Cloudflare manda un código de
  un solo uso (PIN) al correo autorizado.

La app es estática (el motor corre en el navegador con HiGHS en WebAssembly),
así que no hay base de datos de usuarios que mantener.

## Lo que ya está hecho en el repositorio

- `.github/workflows/cloudflare.yml` compila la app y la publica en
  Cloudflare Pages en cada push a `master`. Está **inerte** hasta que existan
  la variable y los secretos del paso 3.
- La búsqueda de direcciones del mapa es opcional:
  - Las coordenadas («lat, lon») nunca salen del navegador.
  - La búsqueda en OpenStreetMap se puede apagar con una casilla.

## Pasos (los hace quien administra)

### 1 · Cuenta de Cloudflare

1. Crear una cuenta gratis en <https://dash.cloudflare.com/sign-up> con el
   correo de trabajo.
2. En **Workers & Pages** anotar el **Account ID**, que aparece en la columna
   derecha.

### 2 · Token para que GitHub publique

1. En **My Profile → API Tokens → Create Token**, elegir **Custom token**.
2. Darle el permiso **Account · Cloudflare Pages · Edit** (solo esta cuenta).
3. Copiar el token. Se muestra una sola vez.

### 3 · Cargar las credenciales en GitHub

No las pegues en el chat. En el repositorio, ir a **Settings → Secrets and
variables → Actions**:

| tipo | nombre | valor |
|---|---|---|
| Secret | `CLOUDFLARE_API_TOKEN` | el token del paso 2 |
| Secret | `CLOUDFLARE_ACCOUNT_ID` | el Account ID del paso 1 |
| Variable | `CF_PAGES_PROJECT` | `ieto` (u otro nombre corto; define la URL `https://<nombre>.pages.dev`) |

Después, en **Actions → cloudflare → Run workflow**:

- La primera corrida crea el proyecto y publica la app.
- Desde ahí, cada push la vuelve a publicar.

### 4 · Activar Zero Trust (plan gratis)

1. En el panel, entrar a **Zero Trust**.
2. Elegir un nombre de equipo (por ejemplo `ieto`).
3. Elegir el plan **Free** (USD 0, hasta 50 usuarios). Es posible que pida un
   medio de pago aunque el plan sea gratis.

### 5 · Proteger el sitio con Access

En **Zero Trust → Access → Applications → Add an application → Self-hosted**:

- **Dominios:**
  - `<nombre>.pages.dev` (producción).
  - `*.<nombre>.pages.dev` (las vistas previas de cada publicación). Sin esto
    quedarían abiertas.
- **Política:**
  - Acción **Allow**.
  - Regla **Include → Emails**: los correos autorizados, uno por uno.
  - Para dar o quitar acceso se edita esta lista.
- **Método de ingreso:** *One-time PIN* (viene activado).

Probar en una ventana privada: `https://<nombre>.pages.dev` debe pedir el
correo y luego el código.

### 6 · Cerrar lo público (cuando el paso 5 funcione)

1. **Repositorio privado:** en GitHub, **Settings → General → Danger zone →
   Change visibility → Private**.
2. **Apagar GitHub Pages:** en **Settings → Pages**, despublicar el sitio.
   Luego se borra `.github/workflows/pages.yml`.
3. **Minutos de CI:**
   - Con el repositorio privado, GitHub Actions da unos 2.000 minutos al mes
     gratis.
   - Las pruebas por push se reducen a la batería de humo; la batería
     completa queda semanal o local (`npm run verify:all`).

## Qué no cambia

- **La versión de escritorio** (motor Julia, `launcher/`) sigue igual y no
  pasa por Cloudflare.
- **Los datos de cada usuario de la versión web** viven en su propio
  navegador (sistemas, corridas y versiones). Cloudflare solo controla quién
  abre la página.
