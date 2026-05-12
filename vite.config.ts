import { reactRouter } from "@react-router/dev/vite"
import babel from "vite-plugin-babel"
import { defineConfig } from "vite"
import path from "path"

export default defineConfig({
  plugins: [
    reactRouter(),
    // App code: react-compiler + react-strict-dom/babel-preset (which includes @stylexjs/babel-plugin)
    babel({
      filter: /\/app\/.*\.[jt]sx?$/,
      babelConfig: {
        presets: [
          "@babel/preset-typescript",
          ["react-strict-dom/babel-preset", { dev: true, platform: "web" }],
        ],
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    // @duro-app/tokens source: the package's `./tokens/*.css` subpath exports
    // resolve to raw `.css.ts` files that contain `css.defineVars(...)` calls.
    // The duro-design-system CLAUDE.md mandates the deep-import pattern
    // (e.g. `@duro-app/tokens/tokens/colors.css`) and explicitly forbids the
    // barrel import — so the consuming app must compile this source itself
    // through `react-strict-dom/babel-preset`, exactly like /app/**.
    // Must run BEFORE the generic stylex rule below so the strict-dom preset
    // (which pre-processes `css.defineVars`) gets first crack.
    babel({
      filter: /node_modules\/@duro-app\/tokens\/.*\.[jt]sx?$/,
      babelConfig: {
        presets: [
          "@babel/preset-typescript",
          ["react-strict-dom/babel-preset", { dev: true, platform: "web" }],
        ],
      },
    }),
    // react-strict-dom source: compile its internal stylex.create calls for SSR
    babel({
      filter: /node_modules\/react-strict-dom/,
      babelConfig: {
        plugins: [
          [
            "@stylexjs/babel-plugin",
            {
              dev: true,
              runtimeInjection: true,
            },
          ],
        ],
      },
    }),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
  ssr: {
    // Force both through Vite's transform pipeline. Without this, SSR loads
    // these from node_modules as native ESM and bypasses the babel rules
    // above — `css.defineVars` then throws at runtime.
    noExternal: ["react-strict-dom", "@duro-app/tokens"],
  },
})
