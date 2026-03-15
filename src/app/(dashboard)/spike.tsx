import { Text, View, Pressable, StyleSheet } from "react-native"
import { useLoaderData } from "expo-router"
import type { LoaderFunction } from "expo-server"
import { useAction, type UseActionReturn } from "~/hooks/useAction"

type SpikeResult = { success: true; counter: number } | { error: string }

interface SpikeLoaderData {
  counter: number
}

export const loader: LoaderFunction<SpikeLoaderData> = async () => {
  return { counter: 0 }
}

export default function SpikePage() {
  const data = useLoaderData<typeof loader>()
  const action1 = useAction<SpikeResult>("/dashboard/spike")
  const action2 = useAction<SpikeResult>("/dashboard/spike")

  const latestCounter =
    (action1.data && "counter" in action1.data ? action1.data.counter : null) ??
    (action2.data && "counter" in action2.data ? action2.data.counter : null) ??
    data.counter

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Mutation Spike</Text>
      <Text style={styles.counter}>Counter: {latestCounter}</Text>

      <Text style={styles.section}>Action 1 (state: {action1.state})</Text>
      <View style={styles.row}>
        <MutationButton action={action1} intent="increment" label="+" />
        <MutationButton action={action1} intent="decrement" label="-" />
      </View>

      <Text style={styles.section}>Action 2 (state: {action2.state})</Text>
      <View style={styles.row}>
        <MutationButton action={action2} intent="reset" label="Reset" />
      </View>

      {action1.data && "error" in action1.data && <Text style={styles.error}>Error: {action1.data.error}</Text>}
      {action2.data && "error" in action2.data && <Text style={styles.error}>Error: {action2.data.error}</Text>}
    </View>
  )
}

function MutationButton({
  action,
  intent,
  label,
}: {
  action: UseActionReturn<SpikeResult>
  intent: string
  label: string
}) {
  return (
    <Pressable
      style={[styles.button, action.state === "submitting" && styles.buttonDisabled]}
      disabled={action.state === "submitting"}
      onPress={() => action.submit({ intent })}
    >
      <Text style={styles.buttonText}>{action.state === "submitting" ? "..." : label}</Text>
    </Pressable>
  )
}

const styles = StyleSheet.create({
  container: { padding: 24 },
  title: { fontSize: 24, fontWeight: "bold", color: "#fff", marginBottom: 16 },
  counter: { fontSize: 48, fontWeight: "bold", color: "#4ade80", marginBottom: 24 },
  section: { fontSize: 14, color: "#999", marginBottom: 8, marginTop: 16 },
  row: { flexDirection: "row", gap: 12 },
  button: {
    backgroundColor: "#3b82f6",
    paddingVertical: 12,
    paddingHorizontal: 24,
    borderRadius: 8,
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  error: { color: "#f87171", marginTop: 12 },
})
