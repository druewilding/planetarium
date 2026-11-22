import { copyFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';

await mkdir('dist/licenses', { recursive: true });
await Promise.all([
  build({ entryPoints: ['src/app.js'], bundle: true, minify: true, outfile: 'dist/app.js',
    format: 'esm', target: ['es2022'], legalComments: 'linked' }),
  ...['index.html', 'styles.css'].map(file => copyFile(file, `dist/${file}`)),
  ...Object.entries({ 'astronomy-engine': 'README.md', three: 'LICENSE',
    'topojson-client': 'LICENSE', 'world-atlas': 'LICENSE' })
    .map(([pkg, file]) => copyFile(`node_modules/${pkg}/${file}`, `dist/licenses/${pkg}.txt`)),
]);
