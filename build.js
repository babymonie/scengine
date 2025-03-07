const esbuild = require('esbuild');

const commonConfig = {
  entryPoints: ['index.js'],
  bundle: true,
  sourcemap: true,
  platform: 'node',
  target: 'node16',
  minify: true,
  external: ['axios', 'cheerio', 'puppeteer', 'fs', 'crypto', 'url',"path"],
};

Promise.all([
  esbuild.build({
    ...commonConfig,
    format: 'cjs',
    outfile: 'dist/scengine.cjs',
  }),
  esbuild.build({
    ...commonConfig,
    format: 'esm',
    outfile: 'dist/scengine.mjs',
  })
]).then(() => console.log('Build complete')).catch(() => process.exit(1));
