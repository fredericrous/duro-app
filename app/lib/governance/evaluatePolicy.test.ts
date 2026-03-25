import { describe, it, expect } from "vitest"
import { evaluatePolicy } from "~/lib/workflows/access-request.server"

describe("evaluatePolicy", () => {
  describe("mode=none", () => {
    it("always approved even with empty approvals", () => {
      expect(evaluatePolicy("none", [])).toBe("approved")
    })

    it("always approved regardless of approval states", () => {
      expect(evaluatePolicy("none", [{ decision: "rejected" }, { decision: null }])).toBe("approved")
    })
  })

  describe("mode=one_of", () => {
    it("one approved out of 3 → approved", () => {
      expect(evaluatePolicy("one_of", [{ decision: "approved" }, { decision: null }, { decision: null }])).toBe(
        "approved",
      )
    })

    it("all rejected → rejected", () => {
      expect(
        evaluatePolicy("one_of", [{ decision: "rejected" }, { decision: "rejected" }, { decision: "rejected" }]),
      ).toBe("rejected")
    })

    it("one pending, one rejected → pending", () => {
      expect(evaluatePolicy("one_of", [{ decision: null }, { decision: "rejected" }])).toBe("pending")
    })

    it("empty approvals list → rejected (vacuous: all rejected)", () => {
      expect(evaluatePolicy("one_of", [])).toBe("rejected")
    })
  })

  describe("mode=all_of", () => {
    it("all approved → approved", () => {
      expect(
        evaluatePolicy("all_of", [{ decision: "approved" }, { decision: "approved" }, { decision: "approved" }]),
      ).toBe("approved")
    })

    it("one rejected → rejected", () => {
      expect(
        evaluatePolicy("all_of", [{ decision: "approved" }, { decision: "rejected" }, { decision: "approved" }]),
      ).toBe("rejected")
    })

    it("two approved, one pending → pending", () => {
      expect(evaluatePolicy("all_of", [{ decision: "approved" }, { decision: "approved" }, { decision: null }])).toBe(
        "pending",
      )
    })

    it("empty approvals list → approved (vacuous: all approved)", () => {
      expect(evaluatePolicy("all_of", [])).toBe("approved")
    })
  })
})
