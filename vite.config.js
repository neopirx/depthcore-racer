import { resolve } from 'node:path';
import { defineConfig, loadEnv } from 'vite';
import { isAdmin } from './server/admin.js';

export default defineConfig(({ mode }) => {
  const admin = mode === 'admin';
  const env = { ...loadEnv(mode, process.cwd(), ''), ...process.env };
  return {
    base: admin ? '/admin/' : './',
    server: {
      host: '127.0.0.1',
      proxy: { '/api': 'http://127.0.0.1:3001' },
    },
    plugins: [{
      name: 'private-editor',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          const path = req.url?.split('?')[0];
          if (path === '/editor.html' || path?.startsWith('/admin/') || path?.startsWith('/src/editor/')) {
            if (!isAdmin(new Headers(req.headers), env)) {
              res.writeHead(401, { 'WWW-Authenticate': 'Basic realm="DEPTHCORE admin"' });
              res.end('Admin access required. Set ADMIN_USER and ADMIN_PASSWORD on the development server.');
              return;
            }
          }
          if (path === '/admin/editor.html') req.url = '/editor.html';
          next();
        });
      },
    }],
    build: {
      outDir: admin ? 'dist-admin' : 'dist',
      rollupOptions: { input: resolve(import.meta.dirname, admin ? 'editor.html' : 'index.html') },
    },
  };
});
