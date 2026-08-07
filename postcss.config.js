export default {
  plugins: {
    "react-strict-dom/postcss-plugin": {
      include: [
        "app/components/**/*.{ts,tsx}",
        "app/hooks/**/*.{ts,tsx}",
        "app/lib/**/*.{ts,tsx}",
        "app/routes/**/*.{ts,tsx}",
      ],
      // This babelConfig is what the plugin runs over every included file to
      // harvest its styles, so it has to contain the preset that actually
      // compiles `css.create` — without it Babel parses the file, finds no
      // StyleX metadata, and `@react-strict-dom` expands to nothing. The app
      // still rendered because the classnames it emits are content hashes:
      // any value @duro-app/ui also uses resolves to a rule the DS stylesheet
      // already ships. Only app-only values (`minHeight: 100vh`,
      // `padding: 32`) had no rule anywhere and silently did nothing.
      //
      // Keep the preset options in sync with the `/app/**` rule in
      // vite.config.ts — the classnames in the markup come from there, and
      // these have to hash to the same thing.
      babelConfig: {
        babelrc: false,
        presets: ["@babel/preset-typescript", ["react-strict-dom/babel-preset", { platform: "web" }]],
        plugins: [["@babel/plugin-syntax-jsx"]],
      },
    },
  },
}
