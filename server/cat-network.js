/**
 * RED NEURONAL DESDE CERO (sin librerías de ML)
 * ------------------------------------------------
 * MLP entrenado con backpropagation real, escrito a mano.
 * Entrada:  histograma de color de la imagen (16 dim) + rasgos del texto (16 dim)
 * Capa oculta: 24 neuronas (ReLU)
 * Salida: 8 dimensiones de estilo (sigmoide) que se convierten en
 *         modificadores de prompt para OpenAI (gpt-image-1).
 *
 * Se entrena al arrancar el servidor con un dataset sintético
 * de etiquetas de estilo felino (épocas configurables).
 */

const IN = 32, H = 24, OUT = 8, EPOCHS = 400, LR = 0.08;

// ---------- utilidades matemáticas ----------
const rand = (scale = 1) => (Math.random() * 2 - 1) * scale;
const relu = (x) => Math.max(0, x);
const dRelu = (x) => (x > 0 ? 1 : 0);
const sigmoid = (x) => 1 / (1 + Math.exp(-x));

class CatNetwork {
  constructor() {
    // pesos inicializados al azar (desde cero, sin pre-entrenar nada)
    this.w1 = Array.from({ length: H }, () => Array.from({ length: IN }, () => rand(0.5)));
    this.b1 = new Array(H).fill(0);
    this.w2 = Array.from({ length: OUT }, () => Array.from({ length: H }, () => rand(0.5)));
    this.b2 = new Array(OUT).fill(0);
    this.trained = false;
    this.lastLoss = null;
  }

  forward(input) {
    const hidden = new Array(H);
    for (let h = 0; h < H; h++) {
      let sum = this.b1[h];
      for (let i = 0; i < IN; i++) sum += input[i] * this.w1[h][i];
      hidden[h] = relu(sum);
    }
    const output = new Array(OUT);
    for (let o = 0; o < OUT; o++) {
      let sum = this.b2[o];
      for (let h = 0; h < H; h++) sum += hidden[h] * this.w2[o][h];
      output[o] = sigmoid(sum);
    }
    return { hidden, output };
  }

  trainSample(input, target) {
    const { hidden, output } = this.forward(input);
    const dOut = new Array(OUT);
    let loss = 0;
    for (let o = 0; o < OUT; o++) {
      const err = output[o] - target[o];
      loss += err * err;
      dOut[o] = err * output[o] * (1 - output[o]); // dLoss/dPreSigmoid
    }
    const dHidden = new Array(H).fill(0);
    for (let o = 0; o < OUT; o++) {
      for (let h = 0; h < H; h++) {
        dHidden[h] += dOut[o] * this.w2[o][h];
        this.w2[o][h] -= LR * dOut[o] * hidden[h];
      }
      this.b2[o] -= LR * dOut[o];
    }
    for (let h = 0; h < H; h++) {
      const dh = dHidden[h] * dRelu(hidden[h]);
      for (let i = 0; i < IN; i++) this.w1[h][i] -= LR * dh * input[i];
      this.b1[h] -= LR * dh;
    }
    return loss / OUT;
  }

  /** Dataset sintético: reglas de estilo felino -> vectores objetivo */
  syntheticDataset(n = 600) {
    const data = [];
    for (let s = 0; s < n; s++) {
      const dark = Math.random();      // fondo oscuro vs claro
      const warm = Math.random();      // tonos cálidos vs fríos
      const detail = Math.random();    // simple vs detallado
      const input = new Array(IN).fill(0);
      for (let i = 0; i < 16; i++) input[i] = Math.random() * 0.3 + (i < 8 ? dark : warm) * 0.7;
      for (let i = 16; i < 32; i++) input[i] = Math.random() * 0.3 + detail * 0.7;
      const target = [
        0.9 * dark, 0.2 + 0.6 * warm, 0.8 * detail, 0.5 + 0.4 * dark,
        0.9 - 0.7 * dark, 0.3 * detail, 0.4 + 0.5 * warm, 0.6 * dark * detail,
      ];
      data.push({ input, target });
    }
    return data;
  }

  /** Entrenamiento completo desde cero */
  train() {
    const data = this.syntheticDataset();
    let last = 0;
    for (let e = 1; e <= EPOCHS; e++) {
      let epochLoss = 0;
      for (const { input, target } of data) epochLoss += this.trainSample(input, target);
      last = epochLoss / data.length;
      if (e % 100 === 0) console.log(`  [red-gato] época ${e}/${EPOCHS} · pérdida ${last.toFixed(4)}`);
    }
    this.lastLoss = last;
    this.trained = true;
    return last;
  }

  /** Extrae histograma de color 16-dim desde un buffer PNG/JPG decodificado como píxeles RGBA */
  imageFeatures(pixels, width, height) {
    const hist = new Array(16).fill(0);
    const step = 4 * Math.max(1, Math.floor((width * height) / 4096));
    let count = 0;
    for (let p = 0; p < pixels.length; p += step * 4) {
      const r = pixels[p], g = pixels[p + 1], b = pixels[p + 2];
      const bright = (r + g + b) / 3;
      const warm = Math.max(0, (r - b) / 255);
      hist[Math.floor((bright / 256) * 8)] += 1;
      hist[8 + Math.min(7, Math.floor(warm * 8))] += 1;
      count++;
    }
    if (!count) return new Array(16).fill(0);
    return hist.map((v) => v / count);
  }

  /** Rasgos de texto 16-dim: hash simple de palabras -> bolsas de rasgos */
  textFeatures(text) {
    const out = new Array(16).fill(0);
    const words = String(text || '').toLowerCase().split(/[^a-záéíóúñ0-9]+/).filter(Boolean);
    for (const w of words) {
      let h = 0;
      for (const c of w) h = (h * 31 + c.charCodeAt(0)) % 997;
      out[h % 16] += 1;
    }
    const max = Math.max(1, ...out);
    return out.map((v) => v / max);
  }

  /** Predicción final: imagen + descripción -> estilos -> texto de prompt */
  predictStyle(imageFeatures16, description) {
    const input = [...imageFeatures16, ...this.textFeatures(description)];
    const { output } = this.forward(input);
    const labels = [
      'fondo oscuro y dramático', 'tonos cálidos dorados', 'alto nivel de detalle en el pelaje',
      'atmósfera nocturna misteriosa', 'fondo luminoso y suave', 'estilo minimalista',
      'luz de atardecer ámbar', 'contraste cinematográfico',
    ];
    const styles = labels
      .map((label, i) => ({ label, score: output[i] }))
      .sort((a, b) => b.score - a.score)
      .slice(0, 3)
      .map((s) => s.label);
    return { styles, raw: output.map((v) => Number(v.toFixed(3))) };
  }
}

module.exports = { CatNetwork };
