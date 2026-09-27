import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

// `npm run dev:headset` uses mode "https": WebXR only works over HTTPS (or localhost),
// so testing on a headset over your LAN needs a (self-signed) certificate.
export default defineConfig(({ mode }) => ({
  // Relative asset paths so the build works from any sub-folder (itch.io, GitHub Pages, etc.)
  base: './',
  plugins: mode === 'https' ? [basicSsl()] : [],
  server: { port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
  test: { environment: 'node', include: ['tests/**/*.test.js'] },
}));
