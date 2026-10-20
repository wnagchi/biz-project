import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const dir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  plugins: [react(), {
    name: 'publish-platform',
    closeBundle() {
      const directory = path.join(dir, 'build');
      const extras = fs.readdirSync(directory).filter(name => name.endsWith('.js') && name !== 'platform.js');
      if (extras.length) throw new Error(`Platform build emitted extra scripts: ${extras.join(', ')}`);
      fs.copyFileSync(path.join(directory, 'platform.js'), path.join(dir, 'platform.js'));
    }
  }],
  build: {
    outDir: path.join(dir, 'build'),
    emptyOutDir: true,
    cssCodeSplit: false,
    modulePreload: false,
    sourcemap: false,
    assetsInlineLimit: 100000000,
    rollupOptions: {
      input: path.join(dir, 'src/main.tsx'),
      output: {
        format: 'es',
        entryFileNames: 'platform.js',
        codeSplitting: false,
        banner: '/* Built from web/src. Run npm run build:web after changing the platform UI. */'
      }
    }
  }
});
