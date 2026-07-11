import * as ImagePicker from "expo-image-picker";
import { Alert, StyleSheet, View } from "react-native";

import type { PickedPhotoAsset } from "../../lib/detail/photo-upload";
import { spacing } from "../../theme";
import { ContributionMessage, SubmitButton } from "./RatingContributionForm";

type Message = { tone: "ok" | "err"; text: string } | null;

/** Auth-gated "Add photo" control for the contribution panel. Owns the `expo-image-picker`
 *  library flow (permission request + single-image pick, JPEG output via `quality: 0.9` with
 *  no `allowsEditing`); the caller owns building the upload descriptor and the mutation itself
 *  (`buildPhotoUpload` / `photoUploadMutation` in `app/fountains/[id].tsx`) so this stays a
 *  thin, focused picker trigger like the other contribution forms. */
export function PhotoUploadButton({
  pending,
  onPick,
  message,
}: {
  pending: boolean;
  onPick: (asset: PickedPhotoAsset) => void;
  message?: Message;
}) {
  async function pickPhoto() {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        "Photo access needed",
        "Allow photo library access in Settings to add a photo of this fountain.",
      );
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: "images",
      quality: 0.9,
    });
    if (result.canceled || result.assets.length === 0) {
      return;
    }
    const asset = result.assets[0];
    onPick({ uri: asset.uri, fileName: asset.fileName, mimeType: asset.mimeType });
  }

  return (
    <View style={styles.wrap}>
      <SubmitButton
        label={pending ? "Uploading…" : "Add photo"}
        disabled={pending}
        pending={pending}
        onPress={pickPhoto}
      />
      <ContributionMessage message={message ?? null} />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: spacing.xs } });
