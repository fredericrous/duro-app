import { describe, expect, it } from "vitest"
import { errorMessage } from "./error-message"

describe("errorMessage", () => {
  it("returns an Error's message", () => {
    expect(errorMessage(new Error("boom"), "fallback")).toBe("boom")
  })

  it("stringifies the message of a plain object with a message property", () => {
    expect(errorMessage({ message: 42 }, "fallback")).toBe("42")
    expect(errorMessage({ message: "nested" }, "fallback")).toBe("nested")
  })

  it("returns the fallback for values without a message", () => {
    expect(errorMessage("just a string", "fallback")).toBe("fallback")
    expect(errorMessage(null, "fallback")).toBe("fallback")
    expect(errorMessage(undefined, "fallback")).toBe("fallback")
    expect(errorMessage({ code: "x" }, "fallback")).toBe("fallback")
  })
})
