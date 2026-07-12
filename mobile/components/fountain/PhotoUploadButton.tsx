import * as ImagePicker from "expo-image-picker";
import { Alert, StyleSheet, View } from "react-native";

import { photoEarnablePoints, type ViewerAwardStateT } from "@fountainrank/contributions";

import type { PickedPhotoAsset } from "../../lib/detail/photo-upload";
import { spacing } from "../../theme";
import {
  ContributionMessage,
  NoPointsNotice,
  PointsPreview,
  SubmitButton,
} from "./RatingContributionForm";

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
  viewerAwardState,
}: {
  pending: boolean;
  onPick: (asset: PickedPhotoAsset) => void;
  message?: Message;
  // What this viewer can still EARN here (#204). `photo_first` is per-FOUNTAIN: only a fountain's
  // first photo earns, so without this the user gets no warning that this upload won't.
  viewerAwardState?: ViewerAwardStateT | null;
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
      {viewerAwardState && !viewerAwardState.photo_first_earnable ? (
        <NoPointsNotice text="Points are only awarded for a fountain's first photo — this one won't earn points." />
      ) : (
        <PointsPreview lines={photoEarnablePoints(viewerAwardState)} />
      )}
      <ContributionMessage message={message ?? null} />
    </View>
  );
}

const styles = StyleSheet.create({ wrap: { gap: spacing.xs } });
