import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: ['src/webview/App.tsx'],
  bundle: true,
  outfile: 'out-webview/webview/main.js',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  jsx: 'automatic',
  define: {
    'process.env.NODE_ENV': '"production"',
  },
});

if (watch) {
  await ctx.watch();
  console.log('Watching webview...');
} else {
  await ctx.rebuild();
  await ctx.dispose();
}
