# Notas de trabajo · LC Systems

Datos de contexto para no perderlos entre sesiones.

## Identidad

| | |
|---|---|
| **Usuario GitHub** | [@limberhuaycho](https://github.com/limberhuaycho) |
| **Repositorio** | https://github.com/limberhuaycho/SERVIDOR-IA-V1 |
| **Correo Git** | `limberhuaychoquispe81@gmail.com` |
| **Usuario local** | `lmrcH/lh/lrcppql` |

> Nunca pegar contraseñas ni tokens personales en un chat o con una IA.
> Para subir, Git Credential Manager abre el navegador y autoriza el usuario.

## Carpeta de trabajo

`H:\PROYECTOS-AI\SERVIDOR-IA-V1` — es la copia de trabajo **y** un repo git
(clonado con todo el historial).

```powershell
$git = 'C:\Program Files\Git\cmd\git.exe'      # Git no esta en el PATH del sistema
cd H:\PROYECTOS-AI\SERVIDOR-IA-V1
& $git status
& $git add -A
& $git commit -m "mensaje"
& $git push origin main
```

## Herramientas del equipo

| Herramienta | Ubicacion |
|-------------|-----------|
| Git 2.55.0 | `C:\Program Files\Git\cmd\git.exe` |
| Node 24.19.0 | `D:\Program Files\nodejs\` |
| pnpm 9.15.9 | `C:\Users\grove\AppData\Roaming\npm\pnpm.cmd` |
| Python 3.13 | `D:\Users\limber\AppData\Local\Programs\Python\Python313\python.exe` |
| ffmpeg 9.0.2 | `%LOCALAPPDATA%\Microsoft\WinGet\Packages\Gyan.FFmpeg_...` |

Notas del entorno:

- La unidad **H: es muy lenta** con muchos archivos pequenos. Para installs
  pesados conviene usar **C:**. Por eso el clon de trabajo se hizo en
  `C:\gh-trabajo\SERVIDOR-IA-V1` y despues se copio el historial a H:.
- PowerShell **bloquea los `.ps1` sin firma**: usar `npm.cmd`, `pnpm.cmd` o
  `powershell -ExecutionPolicy Bypass -File ...`.
- `H:` no registra propietario: por eso existe la entrada
  `safe.directory = H:/PROYECTOS-AI/SERVIDOR-IA-V1` en la config global de git.
- En Windows, el alias `python` apunta al stub de la Microsoft Store. El
  cliente busca un Python real ejecutando `--version` y comprobando la version.

## Estructura

- `src/` — frontend React. **No tocar sin avisar**: ya esta en produccion.
- `server/` — backend Express (`npm start`, puerto 4000).
- `media-dl/` — motor de descargas en Python + `bridge/` que lo expone.
- `downloads/` — archivos ya descargados (ignorado por git).

## Seguridad

`server/.env` contiene la clave de OpenAI y esta en `.gitignore`.
Estuvo versionado por error en el pasado; la clave se revoco.
Si se vuelve a filtrar: <https://platform.openai.com/api-keys>
