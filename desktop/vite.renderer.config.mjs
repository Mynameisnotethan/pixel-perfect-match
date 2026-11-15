// Builds the Lockbox screens into desktop/renderer-dist for the installer. Run from the project root:
//   bunx vite build --config desktop/vite.renderer.config.mjs
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const dir = path.dirname(fileURLToPath(import.meta.url));
export default defineConfig({
  root: path.join(dir, 'renderer'),
  base: './',
  // Ship the logo and other files from the website's public folder inside the installer too.
  publicDir: path.join(dir, '..', 'public'),
  plugins: [react()],
  resolve: { alias: { '@': path.join(dir, '..', 'src') } },
  build: { outDir: path.join(dir, 'renderer-dist'), emptyOutDir: true },
});
