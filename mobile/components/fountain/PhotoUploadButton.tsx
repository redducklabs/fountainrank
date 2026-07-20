import * as ImagePicker from "expo-image-picker";
import { Alert, StyleSheet, View } from "react-native";

import { photoEarnablePoints, type ViewerAwardStateT } from "@fountainrank/contributions";

import type { PickedPhotoAsset } from "../../lib/detail/photo-upload";
import { selectPhoto, type PhotoSource } from "../../lib/detail/photo-picker";
import { spacing } from "../../theme";
import {
  ContributionMessage,
  NoPointsNotice,
  PointsPreview,
  SubmitButton,
} from "./RatingContributionForm";

type Message = { tone: "ok" | "err"; text: string } | null;

/** Auth-gated "Add photo" control for the contribution panel. Owns the `expo-image-picker`
 *  camera/library choice and source-specific permission requests; the caller owns the upload
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
  async function pickPhoto(source: PhotoSource) {
    const result = await selectPhoto(source, ImagePicker);
    if (result.kind === "denied") {
      const camera = result.source === "camera";
      Alert.alert(
        camera ? "Camera access needed" : "Photo access needed",
        camera
          ? "Allow camera access in Settings to take a photo of this fountain."
          : "Allow photo library access in Settings to add a photo of this fountain.",
      );
      return;
    }
    if (result.kind === "picked") onPick(result.asset);
  }

  function chooseSource() {
    Alert.alert("Add fountain photo", "Take a new photo or choose one from your library.", [
      { text: "Take photo", onPress: () => void pickPhoto("camera") },
      { text: "Choose from library", onPress: () => void pickPhoto("library") },
      { text: "Cancel", style: "cancel" },
    ]);
  }

  return (
    <View style={styles.wrap}>
      <SubmitButton
        label={pending ? "Uploading…" : "Add photo"}
        disabled={pending}
        pending={pending}
        onPress={chooseSource}
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
