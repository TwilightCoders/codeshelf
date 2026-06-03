import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const ctx = await esbuild.context({
  entryPoints: {
    'webview/main': 'src/webview/App.tsx',
    'dev/mockHost': 'src/webview/dev/mockHost.ts',
  },
  bundle: true,
  outdir: 'out-webview',
  format: 'iife',
  platform: 'browser',
  target: 'es2020',
  sourcemap: true,
  // Minify the real build; keep watch output readable for debugging.
  minify: !watch,
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
