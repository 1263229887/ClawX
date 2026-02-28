import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';
import { resolve } from 'path';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // 加载环境变量
  const env = loadEnv(mode, process.cwd(), '');
  
  return {
    plugins: [
      react(),
      electron([
        {
          // Main process entry file
          entry: 'electron/main/index.ts',
          onstart(options) {
            options.startup();
          },
          vite: {
            build: {
              outDir: 'dist-electron/main',
              rollupOptions: {
                external: ['electron', 'electron-store', 'electron-updater', 'ws'],
              },
            },
          },
        },
        {
          // Preload scripts entry file
          entry: 'electron/preload/index.ts',
          onstart(options) {
            options.reload();
          },
          vite: {
            build: {
              outDir: 'dist-electron/preload',
              rollupOptions: {
                external: ['electron'],
              },
            },
          },
        },
      ]),
      renderer(),
    ],
    resolve: {
      alias: {
        '@': resolve(__dirname, 'src'),
        '@electron': resolve(__dirname, 'electron'),
      },
    },
    server: {
      port: 5173,
      proxy: {
        // Dana API 代理
        '/api/dana': {
          target: env.DANA_API_BASE_URL || 'http://192.168.80.8',
          changeOrigin: true,
          rewrite: (path) => path.replace(/^\/api\/dana/, ''),
          secure: false,
        },
      },
    },
    build: {
      outDir: 'dist',
      emptyOutDir: true,
    },
  };
});
