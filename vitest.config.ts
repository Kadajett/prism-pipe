import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    globals: true,
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts'],
  },
  resolve: {
    alias: {
      '@core': path.resolve(__dirname, './src/core'),
      '@server': path.resolve(__dirname, './src/server'),
      '@proxy': path.resolve(__dirname, './src/proxy'),
      '@config': path.resolve(__dirname, './src/config'),
      '@rate-limit': path.resolve(__dirname, './src/rate-limit'),
      '@fallback': path.resolve(__dirname, './src/fallback'),
      '@logging': path.resolve(__dirname, './src/logging'),
      '@store': path.resolve(__dirname, './src/store'),
      '@middleware': path.resolve(__dirname, './src/middleware'),
      '@cli': path.resolve(__dirname, './src/cli'),
    },
  },
})
