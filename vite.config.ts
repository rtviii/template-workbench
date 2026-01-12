import { defineConfig } from 'vite';
import { resolve } from 'path';

export default defineConfig(({ mode }) => {
  if (mode === 'lib') {
    return {
      build: {
        lib: {
          entry: resolve(__dirname, 'src/lib/index.ts'),
          name: 'MolstarAlignmentLib',
          fileName: 'molstar-lib',
          formats: ['es'],
        },
        outDir: 'dist/lib',
      },
    };
  }

  // Default: dev server + embed build
  return {
    build: {
      rollupOptions: {
        input: {
          embed: resolve(__dirname, 'src/embed/index.ts'),
        },
        output: {
          entryFileNames: '[name].js',
          dir: 'dist',
        },
      },
    },
  };
});