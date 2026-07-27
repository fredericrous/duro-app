import { Either, Schema } from "effect"
import type { ParseResult } from "effect"

/**
 * Parse-don't-validate for the route boundary.
 *
 * Route actions decode the whole FormData into a typed value in one step
 * instead of `formData.get("x") as string` casts. Failures come back as a
 * typed Either so actions map them into their outcome union — no try/catch,
 * no silent `null as string`.
 *
 * NB: `Object.fromEntries(formData)` keeps the LAST value for a repeated key
 * (multi-valued fields need `formData.getAll` and a bespoke schema); every
 * current form in the app posts single-valued keys.
 */
export const decodeForm =
  <A, I>(schema: Schema.Schema<A, I>) =>
  (formData: FormData): Either.Either<A, ParseResult.ParseError> =>
    Schema.decodeUnknownEither(schema, { errors: "all" })(Object.fromEntries(formData))

/** A required text field: must be a string entry (not a File); trimmed. */
export const FormText = Schema.transform(Schema.String, Schema.String, {
  strict: true,
  decode: (s) => s.trim(),
  encode: (s) => s,
})

/** A required, non-empty (after trim) text field. */
export const FormNonEmptyText = FormText.pipe(Schema.filter((s) => s.length > 0, { message: () => "required" }))

/**
 * An optional text field: absent or empty-after-trim decodes to undefined.
 * (HTML forms submit empty strings for untouched inputs — treat those as
 * "not provided", matching the previous `(...).trim() || undefined` idiom.)
 */
export const FormOptionalText = Schema.optionalWith(
  Schema.transform(Schema.String, Schema.UndefinedOr(Schema.String), {
    strict: true,
    decode: (s) => {
      const t = s.trim()
      return t === "" ? undefined : t
    },
    encode: (s) => s ?? "",
  }),
  { default: () => undefined },
)

/**
 * <input type="date"> posts YYYY-MM-DD — normalize to midnight UTC of that
 * day; anything else passes through untouched.
 */
export const normalizeDateInput = (raw: string): string =>
  /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00.000Z` : raw
