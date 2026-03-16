const { getDefaultConfig } = require("expo/metro-config")
const path = require("path")

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname)

// Alias ~ to ./app (existing source code)
config.resolver.extraNodeModules = {
  "~": path.resolve(__dirname, "app"),
}

// Resolve "source" export condition so @duro-app/ui and @duro-app/tokens
// are compiled by Metro's babel (consistent CSS var hashes with the app).
config.resolver.unstable_conditionNames = [
  "source",
  ...config.resolver.unstable_conditionNames ?? ["import", "require"],
]

// Block @effect/platform's HttpApiScalar from being bundled.
// It embeds the entire Scalar API Reference UI as an inline string (~6MB)
// which crashes Node when loaded as a Metro CJS bundle.
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.includes("httpApiScalar") || moduleName.includes("HttpApiScalar")) {
    return { type: "empty" }
  }
  return context.resolveRequest(context, moduleName, platform)
}

module.exports = config
