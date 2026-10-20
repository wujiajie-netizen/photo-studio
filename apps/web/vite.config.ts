import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [vue()],
  resolve: { alias: { '@photo-studio/shared': fileURLToPath(new URL('../../packages/shared/src/index.ts', import.meta.url)) } },
  optimizeDeps: { exclude: ['@photo-studio/shared'], force: true },
  server: {
    port: 5173,
    strictPort: true,
    /* 保留浏览器访问的 Host，让后端来源校验与前端 Origin 一致。 */
    proxy: { '/api': { target: 'http://127.0.0.1:3000', changeOrigin: false } }
  },
  preview: { host: '127.0.0.1', port: 4173, strictPort: true }
});
