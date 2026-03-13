import { setupServer } from "msw/node"
import { handlers } from "./handlers"
import { seedDevDatabase, DEV_INVITE_TOKEN } from "./seed"

const server = setupServer(...handlers)

server.listen({ onUnhandledRequest: "bypass" })
console.log("[dev] MSW intercepting Vault + LLDAP requests")

// Seed after a short delay to let DB migrations run on first request
const dbPath = process.env.DURO_DB_PATH ?? "./duro-dev.sqlite"
setTimeout(() => {
  try {
    seedDevDatabase(dbPath)
  } catch {
    // DB may not exist yet if no request has triggered migrations — retry later
    setTimeout(() => {
      try {
        seedDevDatabase(dbPath)
      } catch (e) {
        console.warn("[dev] Could not seed database:", (e as Error).message)
      }
    }, 5000)
  }
}, 2000)

console.log(`[dev] Visit http://localhost:5173/invite/${DEV_INVITE_TOKEN}`)
