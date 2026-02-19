import { defineConfig } from "vite"
import path from "path"

export default defineConfig({
  resolve: {
    alias: { "~": path.resolve(__dirname, "./app") },
  },
  build: {
    ssr: true,
    target: "node22",
    outDir: "build/worker",
    rollupOptions: {
      input: path.resolve(__dirname, "app/worker.ts"),
      output: { entryFileNames: "worker.js" },
    },
    emptyOutDir: true,
  },
})
