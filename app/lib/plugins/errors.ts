import { Data } from "effect"

export class PluginError extends Data.TaggedError("PluginError")<{
  readonly message: string
  readonly cause?: unknown
}> {}

export class PluginHostError extends Data.TaggedError("PluginHostError")<{
  readonly pluginSlug: string
  readonly grantId?: string
  readonly message: string
  readonly cause?: unknown
}> {}

export class PluginNotFound extends Data.TaggedError("PluginNotFound")<{
  readonly slug: string
}> {}

export class ScopeViolation extends Data.TaggedError("ScopeViolation")<{
  readonly pluginSlug: string
  readonly service: string
  readonly target: string
  readonly message: string
}> {}

export class ManifestInvalid extends Data.TaggedError("ManifestInvalid")<{
  readonly pluginSlug: string
  readonly message: string
}> {}

export class TemplateError extends Data.TaggedError("TemplateError")<{
  readonly template: string
  readonly variable: string
  readonly message: string
}> {}
