module.exports = function (api) {
  api.cache(true)
  const platform = api.caller((caller) => caller?.platform)
  const isDev = api.caller((caller) => caller?.isDev)
  return {
    presets: [
      [
        "babel-preset-expo",
        {
          "react-strict-dom": {
            debug: isDev,
            dev: isDev,
            platform,
          },
        },
      ],
    ],
  }
}
