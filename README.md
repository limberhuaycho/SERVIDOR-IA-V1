# SERVIDOR-IA-V1 · LC Systems

Estacion de trabajo multimedia con un motor de descargas real (yt-dlp) detras.

## Como esta montado

```
SERVIDOR-IA-V1/
├─ src/                 Frontend React  (NO se toca: ya funciona en GitHub)
├─ server/              Backend Express (aqui se conecto el motor)
│  ├─ server.js         Rutas /api/*
│  └─ media-dl-client.js  Habla con Python y traduce su JSON
├─ media-dl/            Motor de descargas (venia de downloader_cli-master)
│  ├─ src/media_dl/     El motor original, intacto
│  └─ bridge/           Puente que usa Express  ->  ver README-INTEGRACION.md
├─ downloads/           Archivos ya descargados (servidos en /downloads)
├─ dist/                Salida del build para GitHub Pages
└─ .github/workflows/   Despliegue automatico a GitHub Pages
```

El frontend y el backend estan separados a proposito: GitHub Pages solo aloja
la pagina estatica, y el backend corre en tu equipo. Por eso la pagina se ve
online pero las descargas requieren `npm start` en local.

## Puesta en marcha (una vez)

```powershell
powershell -ExecutionPolicy Bypass -File .\instalar-entorno.ps1
```

Comprueba Node, pnpm, Python y ffmpeg, e instala todo lo necesario.

## Cada vez que quieras trabajar

Dos terminales:

```powershell
# Terminal 1 - frontend
pnpm dev          # http://localhost:5173/SERVIDOR-IA-V1/

# Terminal 2 - backend
cd server
npm start         # http://localhost:4000
```

En la web: **Ajustes > Servidor Backend** debe decir `http://localhost:4000`.

## Endpoints

| Endpoint | Para que sirve |
|----------|----------------|
| `GET  /api/health` | Estado del servidor, la red neuronal y el motor |
| `POST /api/download-video` | `{ url, quality }` -> video descargable |
| `POST /api/download-music` | `{ url, format, bitrate }` -> audio descargable |
| `POST /api/tiktok` | TikTok sin marca de agua |
| `POST /api/media-info` | Metadatos: titulo, calidades, formatos, thumbnail |
| `POST /api/generate-image` | DALL-E 3 (o Pollinations sin clave) |
| `POST /api/cat-ai/process` | Red neuronal felina + generacion de imagen |
| `GET  /downloads/:file` | Archivos ya descargados |

Todos los de descarga devuelven la misma forma que el React ya espera:

```json
{ "success": true, "title": "...", "downloadUrl": "...", "quality": "720p" }
```

## Requisitos

| Herramienta | Para que |
|-------------|----------|
| Node.js 24 | Frontend y backend |
| pnpm 9.15.9 | Dependencias del frontend |
| Python 3.11+ | Motor media-dl |
| ffmpeg | Convertir a MP3 y fusionar video+audio |

## Seguridad

`server/.env` contiene la clave de OpenAI y esta en `.gitignore`.
**No la subas a GitHub.** Si alguna vez se subio, revocala en
https://platform.openai.com/api-keys

## Despliegue

`main` dispara `.github/workflows/deploy.yml`, que compila el frontend y lo
publica en GitHub Pages. El backend **no** se despliega: es local.
