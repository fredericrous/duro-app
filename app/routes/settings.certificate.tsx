import { redirect } from "react-router"

// Certificates were reframed as Devices and promoted out of settings to a
// top-level page. Keep this URL working with a permanent redirect so bookmarks
// and links don't break.
export function loader() {
  return redirect("/devices", 301)
}
