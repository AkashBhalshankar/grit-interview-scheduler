import { build, context } from 'esbuild';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
const watch = process.argv.includes('--watch');
rmSync('dist', { recursive: true, force: true }); mkdirSync('dist', { recursive: true }); cpSync('public', 'dist', { recursive: true });
const opts = { entryPoints: { app: 'src/main.jsx' }, bundle: true, outdir: 'dist', minify: !watch, jsx: 'automatic', sourcemap: watch, target: 'es2020', logLevel: 'info', define: { 'process.env.NODE_ENV': watch ? '"development"' : '"production"' } };
if (watch) { const c = await context(opts); await c.watch(); const { port } = await c.serve({ servedir: 'dist', port: 5173 }); console.log(`http://localhost:${port}`); } else await build(opts);
