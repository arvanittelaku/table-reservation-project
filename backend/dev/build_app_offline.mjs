// Offline build of the web app for local tests when npm (and so Vite) is unavailable.
// Uses esbuild + React from /opt/npm-tools. Output: hajde/dist (same layout as `vite build`).
//   node backend/dev/build_app_offline.mjs     (VITE_API_URL from env, default http://localhost:8000)
import { createRequire } from 'module'
import fs from 'fs'
import path from 'path'
const require = createRequire('/opt/npm-tools/node_modules/')
const esbuild = require('esbuild')
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../hajde')
const out = path.join(root, 'dist')
fs.rmSync(out, { recursive: true, force: true })
fs.cpSync(path.join(root, 'public'), out, { recursive: true })
const env = { VITE_API_URL: process.env.VITE_API_URL || 'http://localhost:8000',
  VITE_SUPPORT_WHATSAPP: process.env.VITE_SUPPORT_WHATSAPP || '', VITE_JITSI_DOMAIN: process.env.VITE_JITSI_DOMAIN || '',
  VITE_JITSI_ROOM_PREFIX: process.env.VITE_JITSI_ROOM_PREFIX || '', MODE: 'production', PROD: true, DEV: false }
const r = await esbuild.build({
  entryPoints: [path.join(root, 'src/main.jsx')], bundle: true, splitting: true, format: 'esm',
  outdir: path.join(out, 'assets'), entryNames: 'index-[hash]', chunkNames: '[name]-[hash]', assetNames: '[name]-[hash]',
  jsx: 'automatic', minify: true, metafile: true, nodePaths: ['/opt/npm-tools/node_modules'],
  define: { 'import.meta.env': JSON.stringify(env), 'process.env.NODE_ENV': '"production"' },
  loader: { '.png': 'file', '.jpg': 'file', '.svg': 'file', '.woff2': 'file' },
})
const outs = Object.keys(r.metafile.outputs)
const js = outs.find((f) => /index-[^/]+\.js$/.test(f)), css = outs.find((f) => /index-[^/]+\.css$/.test(f))
let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
html = html.replace('<script type="module" src="/src/main.jsx"></script>',
  `<script type="module" src="/assets/${path.basename(js)}"></script>` + (css ? `<link rel="stylesheet" href="/assets/${path.basename(css)}">` : ''))
fs.writeFileSync(path.join(out, 'index.html'), html)
fs.writeFileSync(path.join(out, 'share-config.json'), JSON.stringify({ url: env.VITE_API_URL }))
console.log('built', outs.length, 'files into', out)
