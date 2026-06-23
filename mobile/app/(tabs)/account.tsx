import { Link } from "expo-router";
import { StyleSheet, Text, View } from "react-native";

import { ScreenContainer } from "../../components/ScreenContainer";
import { isAuthConfigured } from "../../lib/config";
import { useApi } from "../../providers/api-provider";
import { colors, spacing, typography } from "../../theme";

export default function AccountScreen() {
  const { config } = useApi();
  const authReady = isAuthConfigured(config);

  return (
    <ScreenContainer>
      <View style={styles.body}>
        <Text style={styles.title}>Account</Text>
        {authReady ? (
          <Text style={styles.note}>Sign-in UI ships in slice 6e-5.</Text>
        ) : (
          <Text style={styles.note}>
            Browsing FountainRank in public mode. Sign-in is not yet available in this build; rating
            and adding fountains arrive in a later release.
          </Text>
        )}
        <Link href="/diagnostics" style={styles.link}>
          Diagnostics
        </Link>
      </View>
    </ScreenContainer>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, gap: spacing.md },
  title: { ...typography.title, color: colors.brandBlue },
  note: { ...typography.body, color: colors.textMuted },
  link: { ...typography.body, color: colors.brandBlue, fontWeight: "600" },
});
