import { Slot } from "expo-router"
import { View, Text, StyleSheet } from "react-native"

export default function DashboardLayout() {
  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerText}>Duro Dashboard</Text>
      </View>
      <Slot />
    </View>
  )
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: { padding: 16, backgroundColor: "#1a1a2e" },
  headerText: { color: "#fff", fontSize: 18, fontWeight: "bold" },
})
