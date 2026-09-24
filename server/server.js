const express = require('express');
const cors = require('cors');
const dotenv = require('dotenv');
const multer = require('multer');
const { CatNetwork } = require('./cat-network');

dotenv.config();

const app = express();
const PORT = process.env.PORT || 4000;

app.use(cors({ origin: '*' }));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

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
    openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
  });
});

// ----------------------------------------------------
// 2. DESCARGADOR DE TIKTOK (Sin marca de agua)
// ----------------------------------------------------
app.post('/api/tiktok', async (req, res) => {
  const { url } = req.body;
  if (!url || !url.includes('tiktok.com')) {
    return res.status(400).json({ error: 'Proporciona una URL válida de TikTok' });
  }

  try {
    // Usar la API de tikwm
    const response = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
    const data = await response.json();

    if (data.code !== 0 || !data.data) {
      return res.status(400).json({ error: data.msg || 'No se pudo obtener el video de TikTok' });
    }

    const item = data.data;
    res.json({
      success: true,
      title: item.title || 'Video de TikTok',
      author: {
        name: item.author?.nickname || 'Creador',
        unique_id: item.author?.unique_id || 'tiktok',
        avatar: item.author?.avatar,
      },
      cover: item.cover,
      duration: item.duration,
      videoUrl: item.play, // Video sin marca de agua
      videoHdUrl: item.hdplay || item.play,
      musicUrl: item.music,
      musicTitle: item.music_info?.title || 'Audio original',
      stats: {
        plays: item.play_count,
        likes: item.digg_count,
        shares: item.share_count,
      },
    });
  } catch (err) {
    console.error('Error TikTok:', err);
    res.status(500).json({ error: 'Error al conectar con el servicio de TikTok: ' + err.message });
  }
});

// ----------------------------------------------------
// 3. DESCARGADOR DE VIDEO UNIVERSAL (YouTube, Instagram, etc.)
// ----------------------------------------------------
app.post('/api/download-video', async (req, res) => {
  const { url, quality = '720' } = req.body;
  if (!url) return res.status(400).json({ error: 'URL requerida' });

  try {
    // Intentar servicio universal Cobalt público o TikWM si es TikTok
    if (url.includes('tiktok.com')) {
      const tikRes = await fetch(`https://www.tikwm.com/api/?url=${encodeURIComponent(url)}`);
      const data = await tikRes.json();
      if (data.data?.play) {
        return res.json({
          success: true,
          title: data.data.title || 'Video descargado',
          downloadUrl: data.data.play,
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
  const fallbackUrl = `https://image.pollinations.ai/prompt/${cleanPrompt}?width=1024&height=1024&nologo=true&enhance=true`;

  res.json({
    success: true,
    imageUrl: fallbackUrl,
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
