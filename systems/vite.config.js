import { defineConfig } from 'vite';

const port = Number(process.env.PORT || 4173);
export default defineConfig({
  base: process.env.BASE_PATH || './',
  root: new URL('.', import.meta.url).pathname,
  build: { outDir: 'dist/public', emptyOutDir: true },
  server: { port, host: '0.0.0.0', strictPort: true },
  preview: { port, host: '0.0.0.0', strictPort: true }
});