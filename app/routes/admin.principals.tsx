import { redirect } from "react-router"

// The principals list was merged into the unified "Identities" screen (the
// per-principal detail lives at /admin/principals/:id). 301 the list URL so
// existing links keep working.
export function loader() {
  return redirect("/admin/identities", 301)
}
