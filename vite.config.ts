import { reactRouter } from "@react-router/dev/vite";
import babel from "vite-plugin-babel";
import { defineConfig } from "vite";
import path from "path";

export default defineConfig({
  plugins: [
    reactRouter(),
    babel({
      filter: /\/app\/.*\.[jt]sx?$/,
      babelConfig: {
        presets: ["@babel/preset-typescript"],
        plugins: [["babel-plugin-react-compiler"]],
      },
    }),
  ],
  resolve: {
    alias: {
      "~": path.resolve(__dirname, "./app"),
    },
  },
});
