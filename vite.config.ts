import { reactRouter } from "@react-router/dev/vite"
import babel from "vite-plugin-babel"
import { defineConfig } from "vite"
import path from "path"

export default defineConfig({
  plugins: [
    reactRouter(),
    // App code: react-compiler + react-strict-dom/babel-preset (which includes @stylexjs/babel-plugin)
    //
    // `loader: "jsx"`: vite-plugin-babel also hooks this rule into the esbuild
    // run of vite's dependency scan. Babel strips the types but keeps the
    // JSX, and esbuild reads an onLoad result with no loader as plain `js`,
    // so without it the scan fails on every component ("The JSX syntax
    // extension is not currently enabled") and finds their dependencies
    // only when a browser first loads them. See `unstable_optimizeDeps` in
    // react-router.config.ts, which gives the scan its entries.
    babel({
      filter: /\/app\/.*\.[jt]sx?$/,
      loader: "jsx",
      babelConfig: {
        presets: [
          "@babel/preset-typescript",
          ["react-strict-dom/babel-preset", { dev: true, platform: "web", rootDir: process.cwd() }],
        ],
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
    // @greenharness/greenrack-tokens source: the package's `./tokens/*.css` subpath exports
    // resolve to raw `.css.ts` files that contain `css.defineVars(...)` calls.
    // The greenrack design system's CLAUDE.md mandates the deep-import pattern
    // (e.g. `@greenharness/greenrack-tokens/tokens/colors.css`) and explicitly forbids the
    // barrel import — so the consuming app must compile this source itself
    // through `react-strict-dom/babel-preset`, exactly like /app/**.
    // Must run BEFORE the generic stylex rule below so the strict-dom preset
    // (which pre-processes `css.defineVars`) gets first crack.
    babel({
      filter: /node_modules\/@greenharness\/greenrack-tokens\/.*\.[jt]sx?$/,
      babelConfig: {
        presets: [
          "@babel/preset-typescript",
          ["react-strict-dom/babel-preset", { dev: true, platform: "web", rootDir: process.cwd() }],
        ],
      },
    }),
    // react-strict-dom source: compile its internal stylex.create calls for SSR.
    //
    // runtimeInjection is deliberately OFF. It emits each rule from JS as
    // `.cls:not(#\#){...}` — unlayered, with a specificity hack — and unlayered
    // rules beat every cascade layer. react-strict-dom's element reset includes
    // shorthands like `padding:0`, so those injected copies outranked the
    // longhands in @greenharness/greenrack-ui's `@layer priority5` and every DS component
    // rendered with its padding, background and weight stripped. It only showed
    // up in dev: the production bundle has no runtime injection, so there the
    // same rules stay layered and win correctly.
    //
    // The classnames this generates are already defined — layered — in
    // @greenharness/greenrack-ui/dist/index.css, which root.tsx imports, so dropping the
    // injection loses no styles.
    babel({
      filter: /node_modules\/react-strict-dom/,
      babelConfig: {
        plugins: [
          [
            "@stylexjs/babel-plugin",
            {
              dev: true,
              runtimeInjection: false,
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
    noExternal: ["react-strict-dom", "@greenharness/greenrack-tokens"],
  },
})
