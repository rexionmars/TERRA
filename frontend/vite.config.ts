import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

/**
 * Give index.html the splash image list from the module that owns it.
 *
 * The HTML paints a background before any bundle loads, so it cannot import
 * anything -- which is why the paths were duplicated into a script tag with a
 * "keep in sync" comment on both copies. Nothing enforced that: a renamed image
 * meant the HTML painted one photo and React swapped to another on mount.
 *
 * The list is read out of splashBackground.ts and substituted for the
 * __SPLASH_IMAGES__ placeholder at transform time, so one edit reaches both and
 * a missing file is a build error rather than a blank splash.
 */
function splashImages(): Plugin {
  return {
    name: 'terra-splash-images',
    transformIndexHtml(html) {
      const source = path.resolve(__dirname, 'src/lib/splashBackground.ts')
      const text = fs.readFileSync(source, 'utf8')

      const block = text.match(
        /export const SPLASH_IMAGES = \[([\s\S]*?)\] as const/
      )
      if (!block) {
        throw new Error(
          'SPLASH_IMAGES not found in splashBackground.ts; the splash HTML ' +
            'cannot be given its image list'
        )
      }
      const images = [...block[1].matchAll(/"([^"]+)"/g)].map((m) => m[1])
      if (images.length === 0) {
        throw new Error('SPLASH_IMAGES is empty')
      }
      // Every path must exist, or the splash paints nothing and the only
      // symptom is a dark window at launch.
      for (const img of images) {
        const file = path.resolve(__dirname, 'public', img.replace(/^\//, ''))
        if (!fs.existsSync(file)) {
          throw new Error(`splash image missing: ${img}`)
        }
      }
      return html.replace('__SPLASH_IMAGES__', JSON.stringify(images))
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), splashImages()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
