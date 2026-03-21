import { startTransition, StrictMode } from "react"
import { hydrateRoot } from "react-dom/client"
import { HydratedRouter } from "react-router/dom"
import { initI18nClient } from "./lib/i18n.client"

const lng = document.documentElement.lang || "en"

initI18nClient(lng).then(() => {
  startTransition(() => {
    hydrateRoot(
      document,
      <StrictMode>
        <HydratedRouter />
      </StrictMode>,
    )
  })
})
