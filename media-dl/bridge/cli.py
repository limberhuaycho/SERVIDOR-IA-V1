"""CLI used by the Express server to call the media-dl engine.

Usage:
    python -m bridge.cli <command> '<json-args>'

Always prints a single JSON object on stdout so the Node side can parse it
without guessing. Errors go to stderr and are reported as {"ok": false, ...}.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from bridge import engine  # noqa: E402


def _read_payload(argv: list[str]) -> dict:
    """Accept the JSON payload as an argument or, preferably, on stdin.

    Reading from stdin avoids all shell-quoting problems on Windows.
    """
    if len(argv) > 2 and argv[2]:
        return json.loads(argv[2])
    if not sys.stdin.isatty():
        raw = sys.stdin.read().strip()
        if raw:
            return json.loads(raw)
    return {}


def _main(argv: list[str]) -> int:
    if len(argv) < 2:
        print(json.dumps({"ok": False, "error": "Falta el comando."}))
        return 2

    command = argv[1]
    try:
        payload = _read_payload(argv)
    except json.JSONDecodeError as exc:
        print(json.dumps({"ok": False, "error": f"JSON inválido: {exc}"}))
        return 2

    try:
        if command == "health":
            result = engine.health()
        elif command == "info":
            result = engine.media_info(payload["url"])
        elif command == "video":
            result = engine.resolve_video(payload["url"], payload.get("quality", "720"))
        elif command == "audio":
            result = engine.resolve_audio(
                payload["url"],
                payload.get("format", "mp3"),
                payload.get("bitrate", 192),
            )
        else:
            print(json.dumps({"ok": False, "error": f"Comando desconocido: {command}"}))
            return 2
    except KeyError as exc:
        print(json.dumps({"ok": False, "error": f"Falta el campo {exc}"}))
        return 2
    except engine.BridgeError as exc:
        print(json.dumps({"ok": False, "error": str(exc)}))
        return 1
    except Exception as exc:  # pragma: no cover - defensive
        print(json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}))
        return 1

    print(json.dumps(result, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(_main(sys.argv))
