import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// Built into ../public/map and served by the Express app at /map (assets under /static/map/).
// `npm run dev` serves index.html on its own for working on the map in isolation.
export default defineConfig({
  plugins: [react(), tailwindcss()],
  base: '/static/map/',
  build: {
    outDir: '../public/map',
    emptyOutDir: true,
    manifest: true,
    chunkSizeWarningLimit: 2500, // three.js + country borders are one big, cacheable chunk
  },
});
