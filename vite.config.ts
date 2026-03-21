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
    noExternal: ["react-strict-dom"],
  },
})
