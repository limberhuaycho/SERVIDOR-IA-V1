# Motor media-dl integrado en SERVIDOR-IA-V1

Este directorio contiene el motor de descargas **media-dl** (originalmente
`downloader_cli-master`). Se ha integrado aqui para que el backend de Express
pueda resolver enlaces de mas de 100 plataformas con **yt-dlp** real, en lugar
de depender de APIs de terceros que fallan a menudo.

## Que cambia y que no

- **El frontend React no se ha modificado ni una linea.** Sigue pidiendo los
  mismos endpoints y sigue leyendo los mismos campos (`downloadUrl`, `title`,
  `quality`, `format`).
- Lo unico que cambia es **detras**: el backend ahora consulta este motor antes
  que a Cobalt/TikWM, y si el motor falla se cae al metodo anterior.

```
React  --POST /api/download-video-->  Express  --spawn-->  media-dl (yt-dlp)
   ^                                                             |
   |------------ downloadUrl (enlace real)  <----------------------+
```

## Como se usa

El servidor Express no importa Python: lo invoca como un proceso y lee un JSON.

```powershell
cd media-dl
python -m bridge.cli health
python -m bridge.cli info    # <<< '{"url":"https://..."}'
python -m bridge.cli video   # <<< '{"url":"https://...","quality":"1080"}'
python -m bridge.cli audio   # <<< '{"url":"https://...","format":"mp3"}'
```

El payload se lee de **stdin** a proposito: en Windows pasar JSON como
argumento se rompe con las comillas.

## Estructura

| Ruta | Que es |
|------|--------|
| `src/media_dl/` | El motor original, sin tocar (extractores, estrategias, historial) |
| `bridge/engine.py` | Traduce el motor al contrato JSON que espera Express |
| `bridge/cli.py` | Interfaz de linea de comandos que Node invoca |
| `pyproject.toml` | Paquete `media-dl` original |

## Dependencias

Obligatorias: `yt-dlp`, `pydantic`, `typer`, `rich`, `httpx`, `platformdirs`.

| Herramienta | Para que sirve | Si falta |
|-------------|----------------|----------|
| **ffmpeg** | Convertir a MP3/WAV y fusionar video+audio | Se devuelve el audio original o el video sin fusionar |
| aria2c | Descargas mas rapides (16 conexiones) | Se usa el descargador nativo de yt-dlp |

```powershell
winget install Gyan.FFmpeg
pip install -e .            # instala el motor en modo editable
```

## Opcionales

- `spotdl` -> habilita Spotify
- `scdl` -> habilita SoundCloud

## Notas

- `media-dl` estaba instalado en editable apuntando a una ruta vieja
  (`H:\2026\py\...`). Si `pip list` muestra esa ruta, reinstala con
  `pip install -e .` desde este directorio.
- La CLI interactiva original (`media-dl download video <url>`) sigue
  funcionando igual; el bridge es solo un envoltorio adicional.
