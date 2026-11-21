import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./', import.meta.url));

await build({
  absWorkingDir: root,
  entryPoints: ['src/browser.ts'],
  outfile: 'dist/browser.js',
  bundle: true,
  platform: 'browser',
  format: 'esm',
  target: 'es2022',
  plugins: [{
    name: 'hpke-webcrypto',
    setup(builder) {
      // HPKE falls back to Node crypto on older Node hosts. A browser build
      // uses the host Web Crypto API for both paths.
      builder.onResolve({ filter: /^crypto$/ }, ({ importer }) => {
        if (!importer.includes('/@hpke/') && !importer.includes('\\@hpke\\')) return;
        return { path: 'webcrypto', namespace: 'mailport-browser' };
      });
      builder.onLoad({ filter: /.*/, namespace: 'mailport-browser' }, () => ({
        contents: 'export const webcrypto = globalThis.crypto;',
        loader: 'js',
      }));
    },
  }],
});
