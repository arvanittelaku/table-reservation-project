import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/* Writes dist/share-config.json for the Cloudflare Pages Function that builds
 * link previews for /t/<code> (functions/t/[code].js): the public URL of the
 * Django backend, which the browser bundle already contains. */
function shareConfig(env) {
  return {
    name: 'share-config',
    apply: 'build',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'share-config.json',
        source: JSON.stringify({ url: env.VITE_API_URL || '' }),
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), 'VITE_')
  return { plugins: [react(), shareConfig(env)] }
})
