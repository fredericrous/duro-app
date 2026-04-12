import { build } from "esbuild"
import path from "node:path"
import fs from "node:fs"
import { fileURLToPath } from "node:url"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, "..")

const extensions = [".ts", ".tsx", ".js", ".jsx", ""]

await build({
  entryPoints: [path.join(root, "app/worker/worker.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: path.join(root, "build/worker/worker.js"),
  packages: "external",
  plugins: [
    {
      name: "tilde-resolve",
      setup(b) {
        b.onResolve({ filter: /^~\// }, (args) => {
          const base = path.resolve(root, "app", args.path.slice(2))
          for (const ext of extensions) {
            const candidate = base + ext
            if (fs.existsSync(candidate)) {
              return { path: candidate }
            }
          }
          // Directory index
          for (const ext of extensions) {
            const candidate = path.join(base, `index${ext}`)
            if (fs.existsSync(candidate)) {
              return { path: candidate }
            }
          }
          return { path: base }
        })
      },
    },
  ],
  resolveExtensions: extensions.filter(Boolean),
  sourcemap: true,
  logLevel: "info",
})
