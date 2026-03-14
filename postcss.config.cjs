module.exports = {
  plugins: {
    "react-strict-dom/postcss-plugin": {
      include: [
        "app/components/**/*.{ts,tsx}",
        "app/hooks/**/*.{ts,tsx}",
        "app/lib/**/*.{ts,tsx}",
        "src/app/**/*.{ts,tsx}",
      ],
    },
  },
}
