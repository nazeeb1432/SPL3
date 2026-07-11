import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src')
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    emptyOutDir: false,
    lib: {
      entry: path.resolve(__dirname, './src/content/interceptor/interceptor.ts'),
      formats: ['iife'],
      name: 'interceptor',
      fileName: () => 'injected.js'
    }
  }
});