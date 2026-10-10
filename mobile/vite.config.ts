import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// The app reuses the web app's pure domain code (../src/domain) as is.
export default defineConfig({
  plugins: [react()],
  base: './',
  resolve: {
    alias: [
      { find: /^@\/domain\/(.*)$/, replacement: here('../src/domain/$1') },
      { find: /^@\/lib\/(.*)$/, replacement: here('../src/lib/$1') },
      { find: /^~\/(.*)$/, replacement: here('./src/$1') },
      { find: 'zod', replacement: here('./node_modules/zod') },
    ],
  },
  server: { port: 5173, fs: { allow: ['..'] } },
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1500 },
});
