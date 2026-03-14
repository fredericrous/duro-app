import "~/styles/strict.css"
import "@duro-app/ui/dist/index.css"
import "~/lib/i18n.setup"
import { Slot } from "expo-router"
import { ThemeProvider } from "@duro-app/ui"

export default function RootLayout() {
  return (
    <ThemeProvider theme="dark">
      <Slot />
    </ThemeProvider>
  )
}
