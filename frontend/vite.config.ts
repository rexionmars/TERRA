import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import fs from 'fs'
import path from 'path'

/**
 * Give index.html the values it cannot import: the splash image list and the
 * brand tagline.
 *
 * The HTML paints a background before any bundle loads, so it cannot import
 * anything -- which is why the paths were duplicated into a script tag with a
 * "keep in sync" comment on both copies. Nothing enforced that: a renamed image
 * meant the HTML painted one photo and React swapped to another on mount.
 *
 * Both are read out of the modules that own them and substituted for
 * placeholders at transform time, so one edit reaches both copies.
 *
 * The image paths are checked to exist here, because nothing else would catch
 * a renamed file -- the symptom would be a splash that paints nothing. The
 * tagline needs no such check: the React splash imports it, so `tsc` fails the
 * build first and names the module.
 */
function htmlConstants(): Plugin {
  return {
    name: 'terra-html-constants',
    transformIndexHtml(input) {
      let html = input
      const source = path.resolve(__dirname, 'src/lib/splashBackground.ts')
      const text = fs.readFileSync(source, 'utf8')

      // Read off the manifest's path fields rather than a plain array, since
      // each still now carries a code name and its provenance beside its path.
      const block = text.match(
        /export const SPLASH_STILLS: SplashStill\[\] = \[([\s\S]*?)\n\]/
      )
      if (!block) {
        throw new Error(
          'SPLASH_STILLS not found in splashBackground.ts; the splash HTML ' +
            'cannot be given its image list'
        )
      }
      const images = [
        ...block[1].matchAll(/path:\s*"([^"]+)"/g),
      ].map((m) => m[1])
      if (images.length === 0) {
        throw new Error('SPLASH_STILLS declares no paths')
      }

      // The subtitle, from the module that owns it. Hard-coded here it was one
      // more copy nobody would remember to change -- and the line it replaced
      // had already outlived the product it described.
      const brandSource = path.resolve(__dirname, 'src/lib/brand.ts')
      const brand = fs
        .readFileSync(brandSource, 'utf8')
        .match(/export const BRAND_TAGLINE = "([^"]+)"/)
      if (!brand) {
        throw new Error('BRAND_TAGLINE not found in brand.ts')
      }
      html = html.replace('__BRAND_TAGLINE__', brand[1])

      // The release name, so the pre-bundle splash carries it too rather than
      // having it appear a beat later when React mounts.
      const release = fs
        .readFileSync(brandSource, 'utf8')
        .match(/export const RELEASE_NAME = "([^"]+)"/)
      if (!release) {
        throw new Error('RELEASE_NAME not found in brand.ts')
      }
      html = html.replace('__RELEASE_NAME__', release[1])
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
  plugins: [react(), tailwindcss(), htmlConstants()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      /*
        The spectral reference, read from where the sidecar keeps it.

        ONE file, not two. The sidecar needs the seven convolved band values to
        compute an angle and the interface needs the hyperspectral curve and
        the response functions to show what those seven are a summary of. A
        copy under src/ would be a second reference that could disagree with
        the one the numbers were computed from, which is the failure this
        repository has already had with a palette and a set of table columns.
      */
      '@reference': path.resolve(__dirname, '../sidecar/reference'),
    },
  },
  server: {
    fs: {
      // The alias above points outside the project root, which the dev server
      // refuses to serve without being told.
      allow: [path.resolve(__dirname, '..')],
    },
  },
  build: {
    rollupOptions: {
      output: {
        // Rollup would split three out anyway, because the only route to it is
        // a dynamic import. Naming the chunk is the point: an unnamed hash
        // makes the cost of the 3D board illegible in every future build
        // table, and this is the one number worth watching.
        //
        // chunkSizeWarningLimit is deliberately left at its default. The main
        // chunk is already well over it, and that warning is the only thing
        // saying so.
        manualChunks: (id) =>
          id.includes('node_modules/three/') ? 'three' : undefined,
      },
    },
  },
})
