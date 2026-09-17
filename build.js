import * as esbuild from 'esbuild';
import { cpSync, mkdirSync } from 'fs';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: {
    'content/content.bundle': 'src/content/index.js',
    'background/service-worker.bundle': 'src/background/service-worker.js',
  },
  bundle: true,
  outdir: 'dist',
  format: 'iife',
  target: 'chrome112',
  logLevel: 'info',
});

if (watch) {
  await ctx.watch();
  console.log('Watching for changes…');
} else {
  await ctx.rebuild();
  await ctx.dispose();
  mkdirSync('dist/popup',   { recursive: true });
  mkdirSync('dist/assets',  { recursive: true });
  mkdirSync('dist/content', { recursive: true });
  cpSync('src/popup',           'dist/popup',           { recursive: true });
  cpSync('assets',              'dist/assets',           { recursive: true });
  cpSync('manifest.json',       'dist/manifest.json');
  cpSync('src/content/widget.css', 'dist/content/widget.css');
  console.log('Built ✓');
}
