import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');

  return {
    define: {
      'import.meta.env.KAKAO_MAP_JS_KEY': JSON.stringify(env.KAKAO_MAP_JS_KEY || ''),
      'import.meta.env.VITE_ODSAY_API_KEY': JSON.stringify(env.VITE_ODSAY_API_KEY || env.ODSAY_API_KEY || ''),
    },
    server: {
      port: 3000,
      proxy: {
        '/api': {
          target: 'http://localhost:8787',
          changeOrigin: true,
        },
      },
    },
    build: {
      outDir: 'netlify-build',
      reportCompressedSize: false,
    },
  };
});
