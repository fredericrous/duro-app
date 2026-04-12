import { TemplateError } from "./errors"
import type { GrantContext } from "./contracts"

const TEMPLATE_RE = /\$\{([^}]+)\}/g

/**
 * Resolve `${var}` placeholders in a template string against a GrantContext.
 *
 * Supported variables:
 *   ${principal.externalId}, ${principal.email}, ${principal.displayName}
 *   ${grant.reason}
 *   ${config.X}  (any key from the plugin's connected_systems config)
 *   ${appSlug}, ${roleSlug}
 *
 * Throws TemplateError on unknown or null references.
 */
export function resolveTemplate(tmpl: string, ctx: GrantContext): string {
  return tmpl.replace(TEMPLATE_RE, (match, variable: string) => {
    const value = resolveVariable(variable, ctx)
    if (value === null || value === undefined) {
      throw new TemplateError({
        template: tmpl,
        variable,
        message: `Template variable '${variable}' resolved to null`,
      })
    }
    return String(value)
  })
}

/**
 * Resolve a single dotted variable reference against the context.
 * Returns the raw value (which may be null) — the caller decides
 * whether null is acceptable.
 */
function resolveVariable(variable: string, ctx: GrantContext): unknown {
  if (variable === "principal.externalId") return ctx.principal.externalId
  if (variable === "principal.email") return ctx.principal.email
  if (variable === "principal.displayName") return ctx.principal.displayName
  if (variable === "grant.reason") return ctx.grant.reason
  if (variable === "appSlug") return ctx.applicationSlug
  if (variable === "roleSlug") return ctx.role.slug

  if (variable.startsWith("config.")) {
    const key = variable.slice("config.".length)
    if (key in ctx.config) return ctx.config[key]
    throw new TemplateError({
      template: "",
      variable,
      message: `Config key '${key}' not found in plugin config`,
    })
  }

  throw new TemplateError({
    template: "",
    variable,
    message: `Unknown template variable '${variable}'`,
  })
}

/**
 * Resolve all template strings inside a JSON-serialisable value
 * (string fields only, recursive into objects and arrays).
 */
export function resolveTemplateObject(value: unknown, ctx: GrantContext): unknown {
  if (typeof value === "string") return resolveTemplate(value, ctx)
  if (Array.isArray(value)) return value.map((v) => resolveTemplateObject(v, ctx))
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(value)) {
      out[k] = resolveTemplateObject(v, ctx)
    }
    return out
  }
  return value
}
