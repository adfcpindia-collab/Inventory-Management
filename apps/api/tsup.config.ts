import { defineConfig } from 'tsup';

export default defineConfig({
  entry: ['src/server.ts'],
  format: ['esm'],
  outDir: 'dist',
  clean: true,
  // Workspace package ships TypeScript source, so inline it into the bundle.
  noExternal: ['@inventory/shared'],
  banner: {
    js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);",
  },
});
