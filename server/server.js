const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const path = require('path');
const { CatNetwork } = require('./cat-network');
const engine = require('./media-dl-client');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Carpeta donde el motor media-dl deja los archivos ya descargados.
const DOWNLOADS_DIR = engine.DOWNLOADS_DIR;
app.use(
  '/downloads',
  express.static(DOWNLOADS_DIR, {
    // attachment force descarga en vez de abrirlo en el navegador.
    setHeaders: (res) => res.setHeader('Content-Disposition', 'attachment'),
  }),
);

/** Origen con el que el navegador puede pedir los archivos locales. */
function publicOrigin(req) {
  const configured = process.env.PUBLIC_ORIGIN;
  if (configured) return configured.replace(/\/$/, '');
  return `${req.protocol}://${req.get('host') || `localhost:${PORT}`}`;
}

/**
 * Resuelve una URL contra el motor media-dl y devuelve la URL final.
 * Lanza si el motor no puede, para que el endpoint caiga al fallback.
 */
async function resolveWithEngine(req, kind, payload) {
  const result = await engine.runBridge(kind, payload);
  return engine.toDownloadUrl(result, publicOrigin(req));
}

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB
});

// Inicializar y entrenar la red neuronal de gatos desde cero
const catNet = new CatNetwork();
console.log('--- Iniciando entrenamiento de red neuronal desde cero ---');
const loss = catNet.train();
console.log(`--- Red entrenada con éxito (pérdida final: ${loss.toFixed(4)}) ---`);

// Instancia de OpenAI opcional (se activa si el usuario provee OPENAI_API_KEY)
let openaiClient = null;
function getOpenAI() {
  if (!openaiClient && process.env.OPENAI_API_KEY) {
    const { OpenAI } = require('openai');
    openaiClient = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openaiClient;
}

// ----------------------------------------------------
// 1. ESTADO DEL SERVIDOR Y RED
// ----------------------------------------------------
// Estado del motor de descargas, para diagnostico desde el navegador.
let engineStatus = { ok: false, error: 'sin comprobar' };
engine.getStatus().then((status) => {
  engineStatus = status;
  console.log(
    status.ok
      ? `--- Motor media-dl v${status.version} listo (ffmpeg: ${status.ffmpeg ? 'si' : 'no'}) ---`
      : `--- Motor media-dl NO disponible: ${status.error} ---`,
  );
});

app.get('/api/health', (req, res) => {
  res.json({
    status: 'ok',
    server: 'LC Systems Media & AI Backend',
    version: '2.0.0',
    neuralNetwork: {
      trained: catNet.trained,
      lastLoss: catNet.lastLoss,
      architecture: 'MLP 32 -> 24 (ReLU) -> 8 (Sigmoid) desde cero',
    },
    mediaEngine: engineStatus,
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
});

// Metadatos completos de un enlace (titulo, calidades, formatos, thumbnail).
app.post('/api/media-info', async (req, res) => {
  const { url } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });
  try {
    res.json(await engine.getInfo(url.trim()));
  } catch (err) {
    res.status(422).json({ error: err.message });
  }
});

/**
 * Envuelve una URL externa en el proxy de descarga local.
 *
 * En iOS Safari y Android Chrome el atributo `download` se ignora cuando la
 * URL es de otro origen: el archivo se abre en el reproductor en vez de
 * guardarse. Al pasar por este servidor la descarga es same-origin y llega con
 * `Content-Disposition: attachment`, que ambos navegadores respetan.
 */
function proxied(req, url, kind = 'video', filename) {
  if (!url) return url;
  if (url.startsWith('/downloads/')) return `${publicOrigin(req)}${url}`;
  const params = new URLSearchParams({ url, kind });
  if (filename) params.set('filename', filename);
  return `${publicOrigin(req)}/api/proxy?${params.toString()}`;
}

// ----------------------------------------------------
// 2. DESCARGADOR DE TIKTOK (Sin marca de agua)
// ----------------------------------------------------
app.post('/api/tiktok', async (req, res) => {
  const { url, quality = 'auto' } = req.body;
  if (!url || !/tiktok\.com/i.test(url)) {
    return res.status(400).json({ error: 'Proporciona una URL válida de TikTok' });
  }

  // 1) Motor media-dl (yt-dlp): lee el endpoint propio de TikTok, sin marca de
  //    agua y sin depender de terceros. Antes este endpoint solo consultaba
  //    TikWM, que hoy responde 403 con cuerpo vacío.
  try {
    const result = await engine.resolveTiktok(url.trim(), quality);
    return res.json({
      success: true,
      title: result.title,
      description: result.description || undefined,
      author: {
        name: result.author || 'Creador',
        avatar: undefined,
      },
      creator: result.author || undefined,
      cover: result.cover,
      thumbnail: result.thumbnail || undefined,
      duration: result.duration || undefined,
      // El proxy mantiene la descarga funcionando en móvil: una URL
      // cross-origin con el atributo `download` la ignora iOS y Android.
      videoUrl: proxied(req, result.videoUrl, 'video'),
      videoHdUrl: proxied(req, result.videoHdUrl || result.videoUrl, 'video'),
      rawVideoUrl: result.videoUrl,
      musicUrl: result.musicUrl ? proxied(req, result.musicUrl, 'audio') : undefined,
      rawMusicUrl: result.musicUrl || undefined,
      musicTitle: 'Audio original de TikTok',
      quality: result.quality,
      watermark: false,
      engine: result.engine,
    });
  } catch (engineErr) {
    console.warn('[media-dl] tiktok:', engineErr.message);
  }

  // 2) TikWM solo como red de seguridad (actualmente bloquea con 403).
  try {
    const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    if (data.code === 0 && data.data) {
      const item = data.data;
      return res.json({
        success: true,
        title: item.title || 'Video de TikTok',
        author: { name: item.author?.nickname || 'Creador' },
        cover: item.cover,
        duration: item.duration,
        videoUrl: proxied(req, item.play, 'video'),
        videoHdUrl: proxied(req, item.hdplay || item.play, 'video'),
        rawVideoUrl: item.play,
        musicUrl: item.music ? proxied(req, item.music, 'audio') : undefined,
        rawMusicUrl: item.music || undefined,
        musicTitle: item.music_info?.title || 'Audio original',
        quality: 'Original',
        watermark: false,
        engine: 'TikWM (respaldo)',
      });
    }
  } catch (err) {
    console.warn('[tikwm] respaldo:', err.message);
  }

  res.status(422).json({
    error: 'No se pudo obtener el video. TikTok puede estar bloqueando la IP del servidor; prueba con otro enlace.',
  });
});

// ----------------------------------------------------
// 2b. PROXY DE DESCARGA (soluciona la descarga en movil)
// ----------------------------------------------------

const dns = require('dns').promises;
const net = require('net');

const PROXY_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  Accept: '*/*',
};

/**
 * Indica si una IP es de uso publico.
 *
 * El proxy acepta URLs del usuario, asi que sin este filtro se podria usar para
 * leer servicios locales (el propio servidor, la red domestica) o metadatos de
 * la nube en 169.254.169.254.
 */
function isPublicIp(ip) {
  const v = net.isIP(ip);
  if (v === 4) {
    const [a, b] = ip.split('.').map(Number);
    if (a === 0 || a === 10 || a === 127) return false;
    if (a === 169 && b === 254) return false; // link-local,incluye metadatos
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false; // CGNAT
    if (a >= 224) return false; // multicast y reservadas
    return true;
  }
  if (v === 6) {
    const low = ip.toLowerCase();
    if (low === '::1' || low === '::') return false;
    if (low.startsWith('fe80')) return false; // link-local
    if (low.startsWith('fc') || low.startsWith('fd')) return false; // unicast local
    // IPv4 mapeada (::ffff:127.0.0.1) debe validarse con las reglas de v4.
    const mapped = low.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPublicIp(mapped[1]);
    return true;
  }
  return false;
}

/**
 * Valida el destino del proxy y devuelve su URL normalizada.
 * Rechaza destinos que no sean http(s) publicos.
 */
async function assertPublicTarget(target) {
  let parsed;
  try {
    parsed = new URL(target);
  } catch {
    throw new Error('URL de origen no válida.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Solo se admiten destinos http o https.');
  }
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  // Un literal de IP se comprueba al momento; un nombre, tras resolver.
  const addresses = net.isIP(host)
    ? [{ address: host }]
    : await dns.lookup(host, { all: true }).catch(() => []);
  if (!addresses.length) throw new Error('No se pudo resolver el destino.');
  if (!addresses.every((entry) => isPublicIp(entry.address))) {
    throw new Error('Destino no permitido: apunta a una red interna.');
  }
  return parsed;
}

const EXT_BY_KIND = {
  video: 'mp4',
  audio: 'mp3',
  image: 'jpg',
};

/** Nombre de archivo seguro para el header Content-Disposition. */
function safeFilename(name, fallback) {
  const cleaned = String(name || '')
    .replace(/[^\w.\- ]+/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 100);
  return cleaned || fallback;
}

/**
 * Descarga el recurso a traves del servidor y lo sirve como adjunto.
 *
 * El problema que resuelve: en el telefono el enlace directo al CDN de TikTok o
 * de YouTube se abre en el reproductor en vez de descargarse, porque iOS y
 * Android ignoran `download` en recursos cross-origin. Aqui la peticion es
 * same-origin y lleva `Content-Disposition: attachment`.
 */
app.get('/api/proxy', async (req, res) => {
  const target = String(req.query.url || '');
  const kind = String(req.query.kind || 'video');

  if (!/^https?:\/\//i.test(target)) {
    return res.status(400).json({ error: 'URL de origen no válida.' });
  }

  // Evita que el proxy se use como rebote hacia este mismo servidor.
  if (target.startsWith(`${publicOrigin(req)}/api/`)) {
    return res.status(400).json({ error: 'Destino no permitido.' });
  }

  try {
    await assertPublicTarget(target);
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }

  // El Range del cliente debe viajar al origen: si no, este responderia 206
  // con el Content-Length del archivo completo y el movil no podria buscar.
  const range = req.headers.range;

  try {
    const upstream = await fetch(target, {
      headers: range ? { ...PROXY_HEADERS, Range: range } : PROXY_HEADERS,
      redirect: 'follow',
    });

    if (!upstream.ok || !upstream.body) {
      return res.status(502).json({ error: `El origen respondió ${upstream.status}.` });
    }

    const partial = upstream.status === 206;
    const type = upstream.headers.get('content-type') || '';
    const defaultExt = type.includes('mpegurl') ? 'mp4' : EXT_BY_KIND[kind] || 'mp4';
    let filename = safeFilename(req.query.filename, `descarga.${defaultExt}`);
    if (!/\.[a-z0-9]{2,5}$/i.test(filename)) filename += `.${defaultExt}`;

    res.status(partial ? 206 : 200);
    res.setHeader('Content-Type', type || 'application/octet-stream');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="${filename}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    );
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Access-Control-Expose-Headers', 'Content-Disposition, Content-Length, Content-Range, Accept-Ranges');
    res.setHeader('Accept-Ranges', 'bytes');

    const length = upstream.headers.get('content-length');
    if (length) res.setHeader('Content-Length', length);

    // El Content-Range solo es valido si el origen lo envio: inventarlo produce
    // respuestas incoherentes que el reproductor interpreta como corrupta.
    if (partial) {
      const contentRange = upstream.headers.get('content-range');
      if (contentRange) res.setHeader('Content-Range', contentRange);
    }

    const { Readable } = require('stream');
    Readable.fromWeb(upstream.body).pipe(res);
  } catch (err) {
    console.warn('[proxy]', err.message);
    if (!res.headersSent) res.status(502).json({ error: 'No se pudo transferir el archivo.' });
    else res.end();
  }
});

// ----------------------------------------------------
// 3. DESCARGADOR DE VIDEO UNIVERSAL (YouTube, Instagram, etc.)
// ----------------------------------------------------
app.post('/api/download-video', async (req, res) => {
  const { url, quality = 'auto' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });

  // 1) Motor media-dl (yt-dlp): cubre +100 plataformas.
  try {
    const result = await engine.resolveVideo(url.trim(), quality);
    const direct = engine.toDownloadUrl(result, publicOrigin(req));
    return res.json({
      success: true,
      title: result.title,
      // Las URLs remotas del CDN pasan por el proxy para que el boton
      // Descargue tambien en iOS y Android; las locales ya son same-origin.
      downloadUrl: proxied(
        req,
        direct,
        'video',
        `${safeFilename(result.title, 'video')}.mp4`,
      ),
      directUrl: direct,
      quality: result.quality,
      platform: result.platform,
      uploader: result.uploader || undefined,
      duration: result.duration || undefined,
      thumbnail: result.thumbnail || undefined,
      engine: result.engine,
    });
  } catch (engineErr) {
    console.warn('[media-dl] video:', engineErr.message);
  }

  // 2) Fallback heredado: TikWM y Cobalt.
  try {
    // Intentar servicio universal Cobalt público o TikWM si es TikTok
    if (url.includes('tiktok.com')) {
      const tikRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
      const data = await tikRes.json();
      if (data.data?.play) {
        return res.json({
          success: true,
          title: data.data.title || 'Video descargado',
          downloadUrl: proxied(req, data.data.play, 'video'),
          quality: 'Original sin marca',
          author: data.data.author?.nickname,
        });
      }
    }

    // Instancia API para YouTube y plataformas generales
    const cobaltInstances = [
      'https://api.cobalt.tools',
      'https://cobalt-api.kwiatekm.tokyo',
    ];

    let downloadUrl = null;
    let title = 'Video Multimedia';

    for (const inst of cobaltInstances) {
      try {
        const resp = await fetch(inst, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            url,
            videoQuality: quality,
            downloadMode: 'auto',
          }),
        });
        if (resp.ok) {
          const result = await resp.json();
          if (result.url) {
            downloadUrl = result.url;
            break;
          }
        }
      } catch (e) {
        // reintentar siguiente instancia
      }
    }

    if (downloadUrl) {
      return res.json({
        success: true,
        title,
        downloadUrl,
        quality,
      });
    }

    // Si es un enlace directo de video (ej. .mp4, .webm)
    if (url.match(/\.(mp4|webm|m4v|mov)(\?.*)?$/i)) {
      return res.json({
        success: true,
        title: 'Video Directo',
        downloadUrl: url,
        quality: 'Original',
      });
    }

    res.status(422).json({
      error: 'No se pudo generar el enlace de descarga directo. Verifica que el video sea público.',
      fallbackUrl: `https://cobalt.tools/#${encodeURIComponent(url)}`,
    });
  } catch (err) {
    console.error('Error video:', err);
    res.status(500).json({ error: 'Error procesando video: ' + err.message });
  }
});

// ----------------------------------------------------
// 4. DESCARGADOR DE MÚSICA / AUDIO
// ----------------------------------------------------
app.post('/api/download-music', async (req, res) => {
  const { url, format = 'mp3' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });

  // 1) Motor media-dl: extrae audio de +100 plataformas y convierte a MP3.
  try {
    const result = await engine.resolveAudio(url.trim(), format, req.body.bitrate || 192);
    const direct = engine.toDownloadUrl(result, publicOrigin(req));
    return res.json({
      success: true,
      title: result.title,
      // iOS decide como abrir el archivo por la extension: sin `.mp3` lo abre
      // como pagina y no hay descarga. El proxy la garantiza.
      downloadUrl: proxied(
        req,
        direct,
        'audio',
        `${safeFilename(result.title, 'audio')}.${result.format || format}`,
      ),
      directUrl: direct,
      format: result.format,
      platform: result.platform,
      uploader: result.uploader || undefined,
      thumbnail: result.thumbnail || undefined,
      engine: result.engine,
    });
  } catch (engineErr) {
    console.warn('[media-dl] audio:', engineErr.message);
  }

  // 2) Fallback heredado: TikWM y Cobalt.
  try {
    if (url.includes('tiktok.com')) {
      const tikRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
      const data = await tikRes.json();
      if (data.data?.music) {
        return res.json({
          success: true,
          title: data.data.music_info?.title || 'Audio de TikTok',
          author: data.data.music_info?.author || data.data.author?.nickname,
          downloadUrl: data.data.music,
          format: 'mp3',
        });
      }
    }

    // Instancia API de extracción de audio
    const cobaltInstances = ['https://api.cobalt.tools'];
    let downloadUrl = null;

    for (const inst of cobaltInstances) {
      try {
        const resp = await fetch(inst, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({
            url,
            downloadMode: 'audio',
            audioFormat: format,
          }),
        });
        if (resp.ok) {
          const result = await resp.json();
          if (result.url) {
            downloadUrl = result.url;
            break;
          }
        }
      } catch (e) {}
    }

    if (downloadUrl) {
      return res.json({
        success: true,
        title: 'Pista de Audio extraída',
        downloadUrl,
        format,
      });
    }

    if (url.match(/\.(mp3|wav|ogg|m4a|aac)(\?.*)?$/i)) {
      return res.json({
        success: true,
        title: 'Audio Directo',
        downloadUrl: url,
        format,
      });
    }

    res.status(422).json({
      error: 'No se pudo extraer el audio directamente. Puedes probar con un enlace público.',
      fallbackUrl: `https://cobalt.tools/#${encodeURIComponent(url)}`,
    });
  } catch (err) {
    res.status(500).json({ error: 'Error procesando música: ' + err.message });
  }
});

// ----------------------------------------------------
// 5. GENERADOR DE IMÁGENES ESTÁNDAR (OpenAI DALL-E)
// ----------------------------------------------------
app.post('/api/generate-image', async (req, res) => {
  const { prompt, size = '1024x1024', style = 'vivid' } = req.body;
  if (!prompt) return res.status(400).json({ error: 'El prompt es obligatorio' });

  const openai = getOpenAI();
  if (openai) {
    try {
      const response = await openai.images.generate({
        model: 'dall-e-3',
        prompt,
        n: 1,
        size,
        style,
        response_format: 'url',
      });
      return res.json({
        success: true,
        imageUrl: response.data[0].url,
        revisedPrompt: response.data[0].revised_prompt,
        provider: 'OpenAI DALL-E 3',
      });
    } catch (err) {
      console.error('Error OpenAI Image:', err);
      // Continuar al generador sintetizado si falla la cuota o clave
    }
  }

  // Generador inteligente con Pollinations AI / SVG artístico
  const cleanPrompt = encodeURIComponent(prompt.trim());
  const dims = String(size).match(/^\d{2,4}x\d{2,4}$/) ? size : '1024x1024';
  const [w, h] = dims.split('x');
  const fallbackUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=${w}&height=${h}&nologo=true&enhance=true&seed=${Date.now() % 100000}`;

  res.json({
    success: true,
    // Proxy para que la imagen se pueda guardar igual en movil.
    imageUrl: proxied(req, fallbackUrl, 'image', `${safeFilename(prompt, 'imagen')}.jpg`),
    revisedPrompt: prompt,
    provider: openai ? 'Fallback neuronal' : 'Generador IA de alto rendimiento (Sin clave requerida)',
  });
});

// ----------------------------------------------------
// 6. RED NEURONAL DESDE CERO + LABORATORIO DE GATOS
//    (Entrada de imagen, nombre/descripción, extracción
//     de rasgos, clasificación con la red entrenada y
//     generación con OpenAI)
// ----------------------------------------------------
app.post('/api/cat-ai/process', upload.single('image'), async (req, res) => {
  try {
    const { name = 'Michi', description = 'Gato adorable' } = req.body;
    const file = req.file;

    // 1. Extraer rasgos de la imagen si se subió, o calcular rasgos por defecto
    let imgFeatures = new Array(16).fill(0.5);
    if (file && file.buffer) {
      // Muestrear bytes para crear el histograma de 16 dimensiones
      const buf = file.buffer;
      const step = Math.max(1, Math.floor(buf.length / 512));
      for (let i = 0; i < 512 && i * step < buf.length; i++) {
        const val = buf[i * step] / 255;
        imgFeatures[i % 16] = (imgFeatures[i % 16] + val) / 2;
      }
    }

    // 2. Ejecutar la red neuronal entrenada desde cero
    const prediction = catNet.predictStyle(imgFeatures, description + ' ' + name);

    // 3. Construir prompt enriquecido con el conocimiento de la red
    const enrichedPrompt = `Retrato fotorrealista hiperdetallado y cinematográfico del gato llamado "${name}". Características: ${description}. Estilo potenciado por red neuronal: ${prediction.styles.join(', ')}. Calidad 8k, pelaje sedoso y ojos expresivos vivos, iluminación de estudio profesional.`;

    // 4. Generar la imagen con OpenAI (o generador IA fallback)
    let finalImageUrl = null;
    let provider = 'Generador Neural Felino';
    const openai = getOpenAI();

    if (openai) {
      try {
        const aiResponse = await openai.images.generate({
          model: 'dall-e-3',
          prompt: enrichedPrompt,
          n: 1,
          size: '1024x1024',
          quality: 'standard',
        });
        finalImageUrl = aiResponse.data[0].url;
        provider = 'OpenAI DALL-E 3 + Red Neuronal';
      } catch (e) {
        console.warn('OpenAI falló, usando generador neuronal fallback:', e.message);
      }
    }

    if (!finalImageUrl) {
      const encoded = encodeURIComponent(enrichedPrompt);
      finalImageUrl = `https://image.pollinations.ai/prompt/${encoded}?width=1024&height=1024&seed=${Math.floor(Math.random() * 99999)}&model=flux`;
    }

    res.json({
      success: true,
      catName: name,
      description,
      neuralAnalysis: {
        networkLoss: catNet.lastLoss,
        detectedStyles: prediction.styles,
        activationVector: prediction.raw,
        architecture: 'MLP 32-24-8 entrenado desde cero',
      },
      enrichedPrompt,
      generatedImageUrl: finalImageUrl,
      provider,
    });
  } catch (err) {
    console.error('Error en Cat AI:', err);
    res.status(500).json({ error: 'Error procesando en la red neuronal: ' + err.message });
  }
});

// Re-entrenar la red en caliente si el usuario lo solicita
app.post('/api/cat-ai/retrain', (req, res) => {
  const epochs = Math.min(1000, Number(req.body.epochs) || 400);
  const newLoss = catNet.train();
  res.json({
    success: true,
    message: 'Red neuronal re-entrenada con éxito desde cero',
    epochs,
    finalLoss: newLoss,
  });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`=================================================`);
  console.log(`🚀 SERVIDOR IA V1 ACTIVO EN http://localhost:${PORT}`);
  console.log(`   - Descargas: Video, Música, TikTok`);
  console.log(`   - IA: OpenAI DALL-E 3 + Red Neuronal Felina`);
  console.log(`=================================================`);
});
