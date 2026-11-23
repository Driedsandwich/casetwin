import { defineConfig } from 'vite';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
// Missing optional private settings are served as an empty script in Demo mode.
const emptyConfig = '/* No private Firebase configuration. CaseTwin uses Demo mode. */\n';
export default defineConfig({
  plugins: [{
    name: 'optional-private-config',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (request.url?.split('?')[0] === '/firebase-config.js' && !existsSync(resolve(server.config.publicDir, 'firebase-config.js'))) {
          response.setHeader('Content-Type', 'text/javascript'); response.end(emptyConfig);
        } else next();
      });
    },
    generateBundle() {
      if (!existsSync(resolve('public/firebase-config.js'))) this.emitFile({ type: 'asset', fileName: 'firebase-config.js', source: emptyConfig });
    }
  }],
  build: {
    chunkSizeWarningLimit: 500,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if ((id.includes('@firebase/firestore') || id.includes('/firebase/firestore/'))) return 'firebase-firestore';
          if ((id.includes('@firebase/auth') || id.includes('/firebase/auth/'))) return 'firebase-auth';
          if ((id.includes('@firebase/ai') || id.includes('/firebase/ai/'))) return 'firebase-ai';
          if ((id.includes('@firebase/app-check') || id.includes('/firebase/app-check/'))) return 'firebase-appcheck';
          if (id.includes('node_modules')) return 'vendor';
        }
      }
    }
  }
});
