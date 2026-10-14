import { build } from 'esbuild';
await build({
  entryPoints: ['src/index.js'],
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  mainFields: ['module', 'main'],
  conditions: ['workerd', 'worker', 'browser', 'import'],
  target: 'es2022',
  outfile: 'dist/worker.js',
  legalComments: 'none',
});
console.log('ok: dist/worker.js');
