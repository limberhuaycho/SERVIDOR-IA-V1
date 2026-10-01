"""Bridge engine: exposes the media-dl engine to the Node backend.

Resolves metadata, direct download URLs and on-disk files so that the Express
server can answer the exact JSON contract the React front-end already expects,
without the front-end needing any change.
"""

from __future__ import annotations

import asyncio
import os
import re
import shutil
import sys
from pathlib import Path
from typing import Any

# Allow running straight from a checkout, without `pip install -e`.
MEDIA_DL_SRC = Path(__file__).resolve().parents[1] / "src"
if str(MEDIA_DL_SRC) not in sys.path:
    sys.path.insert(0, str(MEDIA_DL_SRC))

import yt_dlp  # noqa: E402
from yt_dlp.utils import DownloadError as YTDLPError  # noqa: E402

from media_dl.core.exceptions import MediaDLError  # noqa: E402
from media_dl.core.extractors import get_extractor  # noqa: E402

#: Where finished files are written; the Node server serves this folder.
DOWNLOAD_ROOT = Path(
    os.environ.get("MEDIA_BRIDGE_DOWNLOADS")
    or (Path(__file__).resolve().parents[2] / "downloads")
)

USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
    "AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/120.0.0.0 Safari/537.36"
)

BASE_OPTS: dict[str, Any] = {
    "quiet": True,
    "no_warnings": True,
    "noprogress": True,
    "http_headers": {
        "User-Agent": USER_AGENT,
        "Accept-Language": "es-ES,es;q=0.9,en;q=0.8",
    },
}

_SAFE_NAME = re.compile(r"[^\w\-. ]+", re.UNICODE)

#: Cache de la busqueda de ffmpeg (se rellena en ``find_ffmpeg``).
_FFMPEG_PATH: str | None = None
_FFMPEG_CHECKED = False


class BridgeError(RuntimeError):
    """Raised when a URL cannot be resolved into a downloadable resource."""


def find_ffmpeg() -> str | None:
    """
    Localiza el ejecutable de ffmpeg y recuerda el resultado.

    ``shutil.which`` solo mira el PATH. Cuando el servidor se lanza como
    proceso en segundo plano (Scheduled Task, servicio, ``Start-Process``) el
    PATH heredado no incluye la carpeta de WinGet, y ffmpeg aparece como
    "no disponible" aunque este instalado. Sin ffmpeg no hay forma de fusionar
    video+audio, que TikTok exige porque sus formatos de video no llevan pista
    de sonido.
    """
    global _FFMPEG_PATH, _FFMPEG_CHECKED
    if _FFMPEG_CHECKED:
        return _FFMPEG_PATH
    _FFMPEG_CHECKED = True

    found = shutil.which("ffmpeg")
    if not found:
        candidates: list[Path] = []
        local_appdata = os.environ.get("LOCALAPPDATA")
        if local_appdata:
            # Paquetes de WinGet, en cualquier version.
            winget = Path(local_appdata) / "Microsoft" / "WinGet" / "Packages"
            if winget.is_dir():
                candidates.extend(sorted(winget.glob("*/ffmpeg*/bin/ffmpeg.exe"), reverse=True))
        candidates += [
            Path("C:/ffmpeg/bin/ffmpeg.exe"),
            Path("D:/ffmpeg/bin/ffmpeg.exe"),
            Path("H:/ffmpeg/bin/ffmpeg.exe"),
        ]
        for candidate in candidates:
            if candidate.is_file():
                found = str(candidate)
                break

    _FFMPEG_PATH = found
    return found


def has_ffmpeg() -> bool:
    """True when ffmpeg is reachable, required for merging/conversion."""
    return find_ffmpeg() is not None


def has_aria2c() -> bool:
    """True when aria2c is reachable, enables the faster download strategy."""
    return shutil.which("aria2c") is not None


def base_opts() -> dict[str, Any]:
    """
    Opciones comunes de yt-dlp.

    ``ffmpeg_location`` se inyecta aqui para que la fusion de video+audio y la
    conversion a MP3 funcionen aunque ffmpeg no este en el PATH del proceso.
    """
    return {
        **BASE_OPTS,
        "ffmpeg_location": find_ffmpeg(),
    }


def _run_async(coro: Any) -> Any:
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        try:
            loop.run_until_complete(loop.shutdown_asyncgens())
        finally:
            loop.close()


def sanitize_filename(name: str, fallback: str = "media") -> str:
    """Turn an arbitrary title into a safe, non-empty file stem."""
    cleaned = _SAFE_NAME.sub("_", name or "").strip(" ._")
    cleaned = re.sub(r"\s+", " ", cleaned)
    return (cleaned[:120] or fallback)


def _height_selector(height: int | None) -> str:
    """Progressive-format selector: a single file that already has audio."""
    if not height:
        return "best[ext=mp4]/best"
    return (
        f"best[ext=mp4][height<={height}][acodec!=none][vcodec!=none]"
        f"/best[height<={height}][acodec!=none]/best"
    )


def _merged_selector(height: int | None) -> str:
    """Highest-quality selector; may need ffmpeg to merge video+audio."""
    if not height:
        # Sin altura: se toma el mejor video y el mejor audio por separado y se
        # fusionan con ffmpeg. Es la unica forma de obtener la maxima calidad
        # real en TikTok, donde los formatos de video nunca traen audio.
        return "bestvideo*+bestaudio/best"
    return f"bestvideo*[height<={height}]+bestaudio/best[height<={height}]/best"


def _parse_height(quality: Any) -> int | None:
    """Accept 1080, '1080', '1080p', 'hd' -> int height; unknown -> None."""
    if quality is None or quality == "":
        return None
    text = str(quality).strip().lower()
    if text in ("auto", "best", "original", "max"):
        return None
    match = re.match(r"(\d{3,4})", text)
    if match:
        value = int(match.group(1))
        return value if 144 <= value <= 4320 else None
    return {"hd": 1080, "fhd": 1080, "fullhd": 1080, "uhd": 2160, "4k": 2160}.get(text)


def extract_info(url: str) -> Any:
    """Return the engine's MediaInfo model for a URL (rich metadata)."""
    extractor = get_extractor(url)
    return _run_async(extractor.extract(url))


def _download_to_disk(url: str, selector: str, stem: str, extra_opts: dict[str, Any]) -> str:
    """Download a single file to DOWNLOAD_ROOT and return its absolute path."""
    DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    target = DOWNLOAD_ROOT / f"{stem}.%(ext)s"

    opts: dict[str, Any] = {
        **base_opts(),
        "format": selector,
        "outtmpl": str(target),
        "noplaylist": True,
        "retries": 5,
        "fragment_retries": 5,
        "continuedl": True,
        # A finished file must never carry a stale ".part" extension.
        "windowsfilenames": True,
        "restrictfilenames": False,
        "overwrites": False,
    }
    if has_aria2c():
        opts["external_downloader"] = "aria2c"
        opts["external_downloader_args"] = {
            "aria2c": ["-x16", "-s16", "-k1M", "--file-allocation=none"]
        }
    opts.update(extra_opts)

    try:
        with yt_dlp.YoutubeDL(opts) as ydl:  # type: ignore[no-untyped-call]
            info = ydl.extract_info(url, download=True)
            path = Path(ydl.prepare_filename(info))
    except YTDLPError as exc:
        raise BridgeError(f"yt-dlp no pudo descargar: {exc}") from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise BridgeError(f"Error inesperado al descargar: {exc}") from exc

    if not path.exists():
        candidates = sorted(
            (p for p in DOWNLOAD_ROOT.glob(f"{glob_escape(stem)}.*") if p.is_file()),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            raise BridgeError("La descarga terminó pero no se encontró el archivo.")
        path = candidates[0]
    return str(path.resolve())


def glob_escape(text: str) -> str:
    """Escape glob metacharacters in a file stem (square brackets are common)."""
    return re.sub(r"([\[\]\*\?])", r"[\1]", text)


def _public_path(file_path: str) -> str:
    """Absolute filesystem path -> the URL the Node server will serve."""
    return f"/downloads/{Path(file_path).name}"


def resolve_video(url: str, quality: Any = "720") -> dict[str, Any]:
    """Resolve a video URL into a downloadable resource.

    Strategy: prefer a single progressive file, which can be handed to the
    browser as a direct link. When the platform only offers separate video and
    audio streams, fall back to downloading and merging with ffmpeg.
    """
    height = _parse_height(quality)
    try:
        media = extract_info(url)
    except MediaDLError as exc:
        raise BridgeError(str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise BridgeError(f"No se pudo analizar el enlace: {exc}") from exc

    title = getattr(media, "title", None) or "Video"
    platform = getattr(media, "platform", None) or "Desconocida"
    duration = getattr(media, "duration", None)

    # Fast path: a direct link avoids pushing bytes through the local server.
    try:
        with yt_dlp.YoutubeDL(
            {**base_opts(), "format": _height_selector(height), "skip_download": True}
        ) as ydl:  # type: ignore[no-untyped-call]
            probe = ydl.extract_info(url, download=False)
        direct = _pick_direct_url(probe)
        if direct:
            return {
                "ok": True,
                "mode": "direct",
                "url": direct,
                "title": title,
                "platform": platform,
                "duration": duration,
                "quality": f"{height}p" if height else "Automática",
                "thumbnail": getattr(media, "thumbnail", None),
                "uploader": getattr(media, "uploader", None),
                "engine": "media-dl + yt-dlp",
            }
    except Exception:
        pass  # fall through to the on-disk path

    stem = sanitize_filename(title)
    path = _download_to_disk(url, _merged_selector(height), stem, {"merge_output_format": "mp4"})
    return {
        "ok": True,
        "mode": "file",
        "path": path,
        "servePath": _public_path(path),
        "title": title,
        "platform": platform,
        "duration": duration,
        "quality": f"{height}p" if height else "Máxima",
        "thumbnail": getattr(media, "thumbnail", None),
        "uploader": getattr(media, "uploader", None),
        "engine": "media-dl + yt-dlp (fusionado)",
    }


def _pick_direct_url(info: Any) -> str | None:
    """Return a single direct URL only when the format is self-contained."""
    if not isinstance(info, dict):
        return None
    if info.get("requested_formats"):
        return None  # needs merging, not a single playable file
    url = info.get("url")
    if isinstance(url, str) and url.startswith("http"):
        return url
    return None


def resolve_audio(url: str, audio_format: str = "mp3", bitrate: int = 192) -> dict[str, Any]:
    """Resolve an audio URL into a downloadable resource.

    ``mp3``/``wav`` need ffmpeg to transcode. When ffmpeg is missing we hand
    over the original audio stream instead of failing, so the endpoint works.
    """
    fmt = (audio_format or "mp3").strip().lower()
    if fmt not in ("mp3", "wav", "m4a", "original"):
        fmt = "mp3"
    try:
        rate = int(bitrate)
    except (TypeError, ValueError):
        rate = 192
    rate = rate if rate in (128, 192, 320) else 192

    try:
        media = extract_info(url)
    except MediaDLError as exc:
        raise BridgeError(str(exc)) from exc
    except Exception as exc:  # pragma: no cover - defensive
        raise BridgeError(f"No se pudo analizar el enlace: {exc}") from exc

    title = getattr(media, "title", None) or "Audio"
    # Spotify resolves to a real audio URL on another platform: use it.
    target = getattr(media, "media_url", None) or url
    thumbnail = getattr(media, "thumbnail", None)
    uploader = getattr(media, "uploader", None)
    platform = getattr(media, "platform", None) or "Desconocida"

    needs_transcode = fmt in ("mp3", "wav")
    if needs_transcode and not has_ffmpeg():
        # No ffmpeg: return the untouched stream rather than an error.
        probe = _probe_audio(target)
        direct = _pick_direct_url(probe)
        if direct:
            return _audio_payload(
                title, platform, thumbnail, uploader,
                url=direct,
                fmt=(probe or {}).get("ext") or "original",
                engine="media-dl (audio original: instala ffmpeg para convertir a MP3)",
            )
        fmt, needs_transcode = "m4a", False

    if not needs_transcode:
        probe = _probe_audio(target)
        direct = _pick_direct_url(probe)
        if direct:
            return _audio_payload(
                title, platform, thumbnail, uploader,
                url=direct,
                fmt=(probe or {}).get("ext") or "m4a",
                engine="media-dl + yt-dlp",
            )

    stem = sanitize_filename(title)
    extra: dict[str, Any] = {}
    if needs_transcode:
        extra = {
            "postprocessors": [
                {
                    "key": "FFmpegExtractAudio",
                    "preferredcodec": fmt,
                    "preferredquality": str(rate),
                }
            ]
        }
    path = _download_to_disk(target, "bestaudio/best", stem, extra)
    final = Path(path)
    if needs_transcode and final.suffix.lower() != f".{fmt}":
        converted = final.with_suffix(f".{fmt}")
        if converted.exists():
            final = converted

    _embed_cover(final, thumbnail)

    return {
        "ok": True,
        "mode": "file",
        "path": str(final),
        "servePath": _public_path(str(final)),
        "title": title,
        "platform": platform,
        "format": final.suffix.lstrip(".").lower(),
        "bitrate": rate if needs_transcode else None,
        "thumbnail": thumbnail,
        "uploader": uploader,
        "engine": "media-dl + yt-dlp",
    }


def _probe_audio(url: str) -> dict[str, Any] | None:
    """Inspect the best audio stream without downloading it."""
    try:
        with yt_dlp.YoutubeDL(
            {**base_opts(), "format": "bestaudio/best", "skip_download": True}
        ) as ydl:  # type: ignore[no-untyped-call]
            return ydl.extract_info(url, download=False)
    except Exception:
        return None


def _audio_payload(
    title: str,
    platform: str,
    thumbnail: str | None,
    uploader: str | None,
    *,
    url: str,
    fmt: str,
    engine: str,
) -> dict[str, Any]:
    return {
        "ok": True,
        # Estos payloads apuntan a una URL directa del CDN: no hay archivo en
        # disco, asi que el modo debe ser "direct" (antes faltaba y lanzaba
        # NameError, tumbando todo el endpoint de audio).
        "mode": "direct",
        "url": url,
        "title": title,
        "platform": platform,
        "format": fmt,
        "bitrate": None,
        "thumbnail": thumbnail,
        "uploader": uploader,
        "engine": engine,
    }


def _embed_cover(path: Path, thumbnail: str | None) -> None:
    """Best-effort cover art; never blocks the download."""
    if not thumbnail:
        return
    try:
        from media_dl.core.cover import embed_cover

        if path.suffix.lower() in (".mp3", ".m4a", ".mp4", ".m4b"):
            embed_cover(path, thumbnail)
    except Exception:
        pass


def media_info(url: str) -> dict[str, Any]:
    """Full metadata for a URL, used by the info endpoint."""
    media = extract_info(url)
    formats = getattr(media, "formats", None) or []
    return {
        "ok": True,
        "id": getattr(media, "id", None),
        "title": getattr(media, "title", None),
        "url": getattr(media, "url", None),
        "platform": getattr(media, "platform", None),
        "uploader": getattr(media, "uploader", None),
        "duration": getattr(media, "duration", None),
        "durationStr": getattr(media, "duration_str", None),
        "thumbnail": getattr(media, "thumbnail", None),
        "viewCount": getattr(media, "view_count", None),
        "isPlaylist": getattr(media, "is_playlist", False),
        "playlistCount": getattr(media, "playlist_count", None),
        "qualities": list(getattr(media, "available_qualities", []) or []),
        "estimatedSize": getattr(media, "estimated_size", None),
        "formats": [
            {
                "id": f.format_id,
                "ext": f.ext,
                "resolution": f.resolution,
                "note": f.quality_note,
                "isVideo": f.is_video,
                "isAudio": f.is_audio,
            }
            for f in formats[:60]
        ],
    }


def resolve_tiktok(url: str, quality: Any = "auto") -> dict[str, Any]:
    """
    Resolve a TikTok link into video + music URLs **without the watermark**.

    TikWM (the third-party API used before) now answers 403/empty bodies, so the
    engine relies on yt-dlp instead, which reads TikTok's own ``play_addr``
    endpoint. That endpoint serves the unwatermarked stream.

    Video and audio are separate streams on TikTok: the returned ``videoUrl`` is
    the video-only track and ``musicUrl`` carries the sound. They are **not**
    merged here, so the JSON advertises ``mode="direct"`` and no ``servePath``:
    a client that needs a single file with sound has to mux the two itself.
    """
    height = _parse_height(quality)

    probe: dict[str, Any] | None = None
    try:
        with yt_dlp.YoutubeDL(
            {**base_opts(), "format": _height_selector(height), "skip_download": True}
        ) as ydl:  # type: ignore[no-untyped-call]
            probe = ydl.extract_info(url, download=False)
    except Exception as exc:  # pragma: no cover - defensive
        raise BridgeError(f"TikTok no pudo resolverse: {exc}") from exc

    if not isinstance(probe, dict):
        raise BridgeError("TikTok no devolvio informacion utilizable.")

    title = probe.get("title") or probe.get("description") or "Video de TikTok"
    uploader = probe.get("uploader") or probe.get("creator") or probe.get("channel")
    cover = probe.get("thumbnail")
    duration = probe.get("duration")

    # The best single progressive stream: TikTok exposes the unwatermarked
    # ``download_addr``/``play_addr`` variants, both without the TikTok logo.
    video_url = _pick_direct_url(probe)
    quality_label = f"{height}p" if height else "Original"

    # yt-dlp exposes separate audio-only formats for TikTok; pick the best one so
    # the front-end can offer the original track even without merging locally.
    music_url = None
    for fmt in probe.get("formats") or []:
        if isinstance(fmt, dict) and fmt.get("acodec") != "none" and fmt.get("vcodec") == "none":
            music_url = fmt.get("url")
            break

    result: dict[str, Any] = {
        "ok": True,
        "mode": "direct",
        "url": video_url,
        "videoUrl": video_url,
        "videoHdUrl": video_url,
        "musicUrl": music_url,
        "title": title,
        "description": probe.get("description") or "",
        "author": uploader,
        "uploader": uploader,
        "platform": "TikTok",
        "duration": duration,
        "thumbnail": cover,
        "cover": cover,
        "watermark": False,
        "quality": quality_label,
        "engine": "media-dl + yt-dlp (sin marca de agua)",
    }
    return result


def _version() -> str:
    try:
        from media_dl import __version__

        return str(__version__)
    except Exception:  # pragma: no cover - defensive
        return "desconocida"


def health() -> dict[str, Any]:
    """Report engine readiness so the Node server can surface it."""
    DOWNLOAD_ROOT.mkdir(parents=True, exist_ok=True)
    ffmpeg = find_ffmpeg()
    return {
        "ok": True,
        "engine": "media-dl",
        "version": _version(),
        "python": sys.version.split()[0],
        "ffmpeg": ffmpeg is not None,
        "ffmpegPath": ffmpeg,
        "aria2c": has_aria2c(),
        "downloadsDir": str(DOWNLOAD_ROOT),
    }
