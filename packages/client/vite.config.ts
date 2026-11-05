import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

// The server's npm version, shown in About and sent to the iOS app in
// `hello`. Display only; never compared.
const serverPackage: unknown = JSON.parse(
  readFileSync(path.resolve(__dirname, '../mobitty/package.json'), 'utf8'),
);
const serverVersion = typeof serverPackage === 'object' && serverPackage !== null
  && 'version' in serverPackage && typeof serverPackage.version === 'string'
  ? serverPackage.version
  : 'unknown';

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
  define: {
    __MOBITTY_SERVER_VERSION__: JSON.stringify(serverVersion),
  },
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
      '/api': {
        target: backendTarget,
      },
    },
  },
});
