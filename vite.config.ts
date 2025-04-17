import { defineConfig } from 'vite';
import path from 'path'; // If using aliases

export default defineConfig({
  plugins: [],
  server: {
    port: 8080 // Default, TDD 12.1
  },
  resolve: { // Optional for aliases
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
      outDir: 'dist' // TDD 2.1, 12.2
  },
  
  publicDir: 'public' // TDD 2.1, 2.6, 10.2
});