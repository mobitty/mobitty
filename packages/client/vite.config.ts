import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

const backendPort = process.env.MOBITTY_SERVER_PORT ?? '5172';
const backendTarget = `http://localhost:${backendPort}`;

const tlsCert = process.env.MOBITTY_TLS_CERT;
const tlsKey = process.env.MOBITTY_TLS_KEY;
const tlsCa = process.env.MOBITTY_TLS_CA;
const httpsConfig = tlsCert !== undefined && tlsKey !== undefined
  ? {
      cert: readFileSync(tlsCert),
      key: readFileSync(tlsKey),
      ...(tlsCa !== undefined ? { ca: readFileSync(tlsCa) } : {}),
    }
  : undefined;

export default defineConfig({
  root: '.',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2022',
  },
  server: {
    https: httpsConfig,
    proxy: {
      '/ws': {
        target: backendTarget,
        ws: true,
      },
      '/token': {
        target: backendTarget,
      },
      '/api': {
        target: backendTarget,
      },
    },
  },
});
