/// <reference types="vitest" />
import { defineConfig } from 'vite';
import angular from '@analogjs/vite-plugin-angular';

export default defineConfig({
  plugins: [angular()],
  test: {
    globals: true,
    setupFiles: ['src/setup-vitest.ts'],
    environment: 'jsdom',
    include: ['src/**/*.spec.ts'],
    reporters: ['default'],
    alias: {
      '@wailsjs/': new URL('./wailsjs/', import.meta.url).pathname,
    },
  },
});
