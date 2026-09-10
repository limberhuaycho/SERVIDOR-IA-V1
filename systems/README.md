# LC Systems

Aplicación local para inspeccionar archivos multimedia y exportar informes sin
usar una base de datos propia.

## Ejecutar en local

Desde `artifacts/lc-systems`:

```bash
pnpm install
pnpm run dev
```

Para generar la versión publicada:

```bash
pnpm run build
```

La compilación queda en:

```text
artifacts/lc-systems/dist/public/
```

## Publicar en GitHub Pages

No publiques `artifacts/lc-systems/index.html` como si fuera la compilación
final: es la entrada de desarrollo y necesita Vite para resolver sus módulos
JavaScript.

Publica **todo el contenido** de `dist/public/`, incluyendo la carpeta
`assets/`:

```text
dist/public/index.html
dist/public/assets/
dist/public/favicon.svg
dist/public/robots.txt
```

En GitHub Pages, configura como carpeta publicada la carpeta que contiene
`index.html` y `assets/`. No abras el HTML con doble clic usando `file://`;
debe servirse por HTTP.

Para probar la compilación sin GitHub:

```bash
pnpm run serve
```

Luego abre la URL que indique Vite, normalmente `http://localhost:4173/`.

Para GitHub Pages publica todo el contenido de `dist/public/` (incluidos
`index.html`, `assets/`, `favicon.svg` y `robots.txt`) como la carpeta del sitio.