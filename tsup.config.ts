import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/lib.ts', 'src/index.ts', 'src/cli/index.ts'],
  format: ['esm'],
  outDir: 'dist',
  splitting: true,
  sourcemap: true,
  dts: true,
  clean: true,
  target: 'es2024',
  platform: 'node',
  // Keep directory structure for chunk outputs
  outExtension: () => ({ js: '.js' }),
  // Don't bundle node_modules
  external: [/^[^./]/],
  // Preserve dynamic imports
  noExternal: [],
});
