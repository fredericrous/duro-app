import { describe, expect, it } from "vitest"
import { loader } from "./settings.certificate"
import { callLoader, expectData } from "~/test/route-utils"

describe("/settings/certificate", () => {
  it("permanently redirects to the Devices page", async () => {
    // Certificates moved out of settings; the old URL has to keep working for
    // anyone who bookmarked it.
    const result = await callLoader(loader)
    const response = expectData<Response>(result)
    expect(response.status).toBe(301)
    expect(response.headers.get("Location")).toBe("/devices")
  })
})
