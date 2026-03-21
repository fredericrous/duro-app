export default {
  plugins: {
    "react-strict-dom/postcss-plugin": {
      include: [
        "app/components/**/*.{ts,tsx}",
        "app/hooks/**/*.{ts,tsx}",
        "app/lib/**/*.{ts,tsx}",
        "app/routes/**/*.{ts,tsx}",
      ],
      babelConfig: {
        presets: ["@babel/preset-typescript"],
        plugins: [["@babel/plugin-syntax-jsx"]],
      },
    },
  },
}
