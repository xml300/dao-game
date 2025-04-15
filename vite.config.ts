import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    chunkSizeWarningLimit: 1600, // Phaser + new code might exceed default
  },
  server: {
    // Optional: configure server port
    // port: 3000
  },
  assetsInclude: ['**/*.png', '**/*.jpg', '**/*.jpeg', '**/*.gif', '**/*.svg', '**/*.wav', '**/*.mp3', '**/*.ogg']
});