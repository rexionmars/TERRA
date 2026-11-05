// defineConfig comes from vitest/config, which is vite's own function with the
// `test` key below added to its type. Imported from vite, that key fails tsc,
// and the usual way out of that error is the second config file the comment on
// `test` explains this repository does not want.
import { defineConfig } from "vitest/config"
import { type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import fs from "fs"
import path from "path"

/**
 * Give index.html the value it cannot import: the brand tagline.
 *
 * The HTML paints a splash before any bundle loads, so it cannot import
 * anything, and a copy of the line typed into it would be one more that nobody
 * remembers to change. It is read out of the module that owns it and
 * substituted for a placeholder at transform time, so one edit reaches both
 * copies of the splash. No check that it took is needed: the React splash
 * imports the same constant, so `tsc` fails the build first and names the
 * module.
 */
function htmlConstants(): Plugin {
  return {
    name: "terra-html-constants",
    transformIndexHtml(html) {
      // The line it replaced had already outlived the product it described.
      const brandSource = path.resolve(__dirname, "src/lib/brand.ts")
      const brand = fs
        .readFileSync(brandSource, "utf8")
        .match(/export const BRAND_TAGLINE = "([^"]+)"/)
      if (!brand) {
        throw new Error("BRAND_TAGLINE not found in brand.ts")
      }
      return html.replace("__BRAND_TAGLINE__", brand[1])
    },
  }
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss(), htmlConstants()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      /*
        The spectral reference, read from where the sidecar keeps it.

        ONE file, not two. The sidecar needs the seven convolved band values to
        compute an angle and the interface needs the hyperspectral curve and
        the response functions to show what those seven are a summary of. A
        copy under src/ would be a second reference that could disagree with
        the one the numbers were computed from, which is the failure this
        repository has already had with a palette and a set of table columns.
      */
      "@reference": path.resolve(__dirname, "../sidecar/reference"),
    },
  },
  server: {
    fs: {
      // The alias above points outside the project root, which the dev server
      // refuses to serve without being told.
      allow: [path.resolve(__dirname, "..")],
    },
  },
  /*
    Vitest reads this file rather than a vitest.config.ts of its own. That
    second file would have to restate the two aliases above to resolve
    anything, and one of them is @reference -- which exists because a
    reference spectrum kept in two places is a reference that can disagree
    with itself. Tests resolving a different copy than the bundle is that
    same failure with a worse ending, since the tests would go on passing
    against the copy nobody ships.
  */
  test: {
    /*
      node, not jsdom. What is under test today is pure modules in src/lib --
      arithmetic over numbers, with no element anywhere in an assertion -- so a
      DOM would be a dependency to install and a document to build per file
      that nothing reads.

      This is a decision, not a default to inherit. The first component test
      changes this line to 'jsdom' and adds jsdom as a devDependency in the
      same edit; until someone has a reason to, the runner stays as light as
      the tests are.
    */
    environment: "node",
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
          id.includes("node_modules/three/") ? "three" : undefined,
      },
    },
  },
})
