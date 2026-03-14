import { Text, View, StyleSheet } from "react-native"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"

interface DashboardLoaderData {
  user: string
  email: string
  groups: string[]
  timestamp: number
}

export const loader: LoaderFunction<DashboardLoaderData> = async (request) => {
  try {
    const { getSession } = await import("~/lib/session.server")
    const session = await getSession(request as unknown as Request)
    if (session) {
      return { user: session.name, email: session.email, groups: session.groups, timestamp: Date.now() }
    }
  } catch {
    // In dev mode, dynamic imports may not resolve in loader bundles
  }
  return { user: "dev", email: "dev@localhost", groups: ["dev"], timestamp: Date.now() }
}

export default function DashboardHome() {
  const data = useLoaderData<typeof loader>()

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Welcome, {data.user}</Text>
      <Text style={styles.info}>Email: {data.email}</Text>
      <Text style={styles.info}>Groups: {data.groups.join(", ") || "none"}</Text>
    </View>
  )
}

const styles = StyleSheet.create({
  container: { padding: 24 },
  title: { fontSize: 24, fontWeight: "bold", marginBottom: 8, color: "#fff" },
  info: { fontSize: 14, color: "#ccc", marginBottom: 4 },
})
