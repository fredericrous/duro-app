import "~/styles/strict.css"
import "@duro-app/ui/dist/index.css"
import "~/lib/i18n.setup"
import type { ReactNode } from "react"
import { Slot } from "expo-router"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { ThemeProvider } from "@duro-app/ui"
import { DevToolbar } from "~/components/DevToolbar/DevToolbar"

const queryClient = new QueryClient()

const isDev = process.env.NODE_ENV === "development"

function MaybeDevToolbar({ children }: { children: ReactNode }) {
  if (!isDev) return <>{children}</>
  return <DevToolbar>{children}</DevToolbar>
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider theme="dark">
        <MaybeDevToolbar>
          <Slot />
        </MaybeDevToolbar>
      </ThemeProvider>
    </QueryClientProvider>
  )
}
