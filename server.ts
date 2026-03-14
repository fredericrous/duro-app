import path from "node:path"
import express from "express"
import compression from "compression"
import { createRequestHandler } from "expo-server/adapter/express"

const CLIENT_BUILD_DIR = path.join(process.cwd(), "dist/client")
const SERVER_BUILD_DIR = path.join(process.cwd(), "dist/server")

const app = express()

app.use(compression())
app.disable("x-powered-by")

app.use(
  express.static(CLIENT_BUILD_DIR, {
    maxAge: "1h",
    extensions: ["html"],
  }),
)

const requestHandler = createRequestHandler({
  build: SERVER_BUILD_DIR,
})

app.all("*", requestHandler)

const port = Number(process.env.PORT) || 3000
app.listen(port, () => {
  console.log(`Express server listening on http://localhost:${port}`)
})
