import { redirect } from "react-router"

// Users and Principals were merged into a single type-faceted "Identities"
// screen. Keep this URL working with a permanent redirect so bookmarks and
// links don't break.
export function loader() {
  return redirect("/admin/identities", 301)
}
