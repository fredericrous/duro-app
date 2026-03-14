import type { PropsWithChildren } from "react"

export default function RootHtml({ children }: PropsWithChildren) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Duro</title>
      </head>
      <body>{children}</body>
    </html>
  )
}
