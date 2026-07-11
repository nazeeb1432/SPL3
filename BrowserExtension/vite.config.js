import { defineConfig } from "vite";
import webExtension from "vite-plugin-web-extension";
import path from "path";

export default defineConfig({
  plugins: [
    webExtension({
      manifest: "./public/manifest.json",
      browser: "chrome",
      verbose: true,
      disableAutoLaunch: true,
      additionalInputs: ["src/content/interceptor/interceptor.ts"],
    }),
  ],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      output: {
        entryFileNames: (chunk) => {
          if (chunk.name === 'interceptor') {
            return 'injected.js';
          }
          if (chunk.name === 'index' && chunk.facadeModuleId?.includes('background')) {
            return 'src/background/index.js';
          }
          if (chunk.name === 'content-script') {
            return 'src/content/content-script.js';
          }
          return `${chunk.name}.js`;
        },
        chunkFileNames: 'assets/chunk-[hash].js',
        assetFileNames: (assetInfo) => {
          const name = assetInfo.names?.[0] || assetInfo.name;
          if (name && name.endsWith('.css')) {
            return name;
          }
          return 'assets/[name][extname]';
        },
      },
    },
  },
});