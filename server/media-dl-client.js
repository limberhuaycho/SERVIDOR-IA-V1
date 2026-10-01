/**
 * Cliente del motor Python media-dl.
 *
 * El frontend React no cambia: este modulo se limita a resolver la URL contra
 * el motor yt-dlp y a devolver un recurso descargable. Si Python no esta
 * disponible, `isAvailable()` lo indica y server.js usa su fallback anterior.
 */

const { spawn } = require('child_process');
const path = require('path');

const ENGINE_DIR = path.resolve(__dirname, '..', 'media-dl');
const DOWNLOADS_DIR = path.resolve(__dirname, '..', 'downloads');

// Candidatos a interprete, en orden de preferencia.
const PYTHON_CANDIDATES = [
  process.env.MEDIA_DL_PYTHON,
  'python',
  'python3',
  'py',
  'D:\\Users\\limber\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
  'D:\\Python312\\python.exe',
  'C:\\Users\\grove\\AppData\\Local\\Programs\\Python\\Python313\\python.exe',
].filter(Boolean);

let cachedPython;
let pythonLookup;

/** Ejecuta `exe --version` y devuelve true si es un Python real. */
function probePython(exe) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(exe, ['--version'], { windowsHide: true, shell: false });
    } catch {
      resolve(false);
      return;
    }
    let out = '';
    const done = (ok) => {
      try { child.kill(); } catch { /* ya termino */ }
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 8000);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { out += d; });
    child.on('error', () => { clearTimeout(timer); resolve(false); });
    child.on('close', (code) => {
      clearTimeout(timer);
      // El stub de la Microsoft Store responde con codigo 9009 y un texto
      // que invita a instalar Python: eso no es un interprete utilizable.
      resolve(code === 0 && /python\s*\d/i.test(out));
    });
  });
}

/**
 * Localiza un interprete de Python real, cacheando el resultado.
 * No basta con el primero de la lista: en Windows `python` suele apuntar al
 * alias de la Microsoft Store, que existe pero no ejecuta nada.
 */
async function findPython() {
  if (cachedPython) return cachedPython;
  if (!pythonLookup) {
    pythonLookup = (async () => {
      for (const candidate of PYTHON_CANDIDATES) {
        // eslint-disable-next-line no-await-in-loop
        if (await probePython(candidate)) {
          cachedPython = candidate;
          return cachedPython;
        }
      }
      return null;
    })();
  }
  return pythonLookup;
}

/**
 * Ejecuta un comando del bridge y devuelve su JSON.
 * @param {string} command health | info | video | audio
 * @param {object} payload
 * @param {number} timeoutMs
 */
function runBridge(command, payload = {}, timeoutMs = 300000) {
  // findPython() es asincrono, asi que se resuelve antes de armar el Promise:
  // dentro de un executor `new Promise` no se puede usar `await`.
  return findPython().then((python) => new Promise((resolve, reject) => {
    if (!python) {
      reject(new Error('No se encontro un interprete de Python utilizable.'));
      return;
    }

    const child = spawn(python, ['-m', 'bridge.cli', command], {
      cwd: ENGINE_DIR,
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONIOENCODING: 'utf-8',
        PYTHONUTF8: '1',
        MEDIA_BRIDGE_DOWNLOADS: DOWNLOADS_DIR,
        MEDIA_DL_CONFIG_DIR: path.join(DOWNLOADS_DIR, '.config'),
      },
    });

    let stdout = '';
    let stderr = '';
    let settled = false;

    const timer = setTimeout(() => {
      settled = true;
      child.kill();
      reject(new Error(`El motor tardo mas de ${Math.round(timeoutMs / 1000)}s y se cancelo.`));
    }, timeoutMs);

    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });

    child.on('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });

    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);

      const line = stdout.trim().split('\n').filter(Boolean).pop();
      if (!line) {
        const detail = (stderr || '').trim().split('\n').slice(-3).join(' ');
        reject(new Error(detail || `El motor termino con codigo ${code}.`));
        return;
      }

      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        reject(new Error(`Respuesta ilegible del motor: ${line.slice(0, 200)}`));
        return;
      }

      if (!parsed.ok) {
        reject(new Error(parsed.error || 'El motor no pudo resolver el enlace.'));
        return;
      }
      resolve(parsed);
    });

    // El payload viaja por stdin: evitar problemas de comillas en Windows.
    child.stdin.on('error', () => {});
    child.stdin.write(JSON.stringify(payload));
    child.stdin.end();
  }));
}

/** Estado del motor, o null si no responde. */
async function getStatus() {
  try {
    return await runBridge('health', {}, 30000);
  } catch (err) {
    return { ok: false, error: err.message };
  }
}

function resolveVideo(url, quality) {
  return runBridge('video', { url, quality }, 600000);
}

function resolveAudio(url, format, bitrate) {
  return runBridge('audio', { url, format, bitrate }, 600000);
}

/**
 * TikTok sin marca de agua via yt-dlp.
 *
 * Antes este flujo dependia por completo de la API de TikWM, que hoy responde
 * 403 con cuerpo vacio. yt-dlp lee el endpoint propio de TikTok, asi que no
 * depende de ningun intermediario.
 */
function resolveTiktok(url, quality = 'auto') {
  return runBridge('tiktok', { url, quality }, 180000);
}

function getInfo(url) {
  return runBridge('info', { url }, 120000);
}

/** Convierte la respuesta del motor en la URL que consume el React. */
function toDownloadUrl(result, origin) {
  if (result.mode === 'file') {
    return `${origin}${result.servePath}`;
  }
  return result.url;
}

module.exports = {
  ENGINE_DIR,
  DOWNLOADS_DIR,
  getStatus,
  resolveVideo,
  resolveAudio,
  resolveTiktok,
  getInfo,
  toDownloadUrl,
  runBridge,
};
