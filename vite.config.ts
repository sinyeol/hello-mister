import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react-swc';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  base: './',
  plugins: [react()],
  resolve: {
    alias: {
      '@sticker-v1': path.resolve(projectRoot, 'src/features/sticker-v1'),
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5174,
  },
  build: {
    sourcemap: true,
  },
});
