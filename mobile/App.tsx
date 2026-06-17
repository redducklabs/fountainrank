import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { makeClient } from "@fountainrank/api-client";

const API_BASE_URL = "http://localhost:8000";

type Status = "loading" | "ok" | "error";

export default function App() {
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    makeClient(API_BASE_URL)
      .GET("/healthz")
      .then(({ data, error }) => setStatus(!error && data?.status === "ok" ? "ok" : "error"))
      .catch(() => setStatus("error"));
  }, []);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>FountainRank</Text>
      <Text>Backend status: {status}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: "center", justifyContent: "center" },
  title: { fontSize: 24, fontWeight: "bold" },
});
