import { Text, View } from "react-native";

export default function Home() {
  return (
    <View style={{ flex: 1, alignItems: "center", justifyContent: "center", gap: 8 }}>
      <Text style={{ fontSize: 20, fontWeight: "600" }}>CareBridge Field</Text>
      <Text>Phase 2 — offline-first caregiver/nurse app. Scaffold only.</Text>
    </View>
  );
}
