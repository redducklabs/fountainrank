import type { components } from "@fountainrank/api-client";
import { Image } from "expo-image";
import { Pressable, StyleSheet, View } from "react-native";

import { heroPhoto, seeAllPhotosLabel } from "../../lib/detail/fountain-detail";
import { resolvePhotoUrl } from "../../lib/detail/photo-carousel";
import { colors } from "../../theme";
import { useFountainDetailTabs } from "./FountainDetailTabs";

type PhotoOut = components["schemas"]["PhotoOut"];

const ASPECT_RATIO = 3 / 4; // height = width * ratio, matching PhotoCarousel's 4:3

/** Single newest-photo hero atop the Info tab; tapping opens the Photos tab. Rendered only
 *  when a photo exists. Uses the same API-base URL resolution as `PhotoCarousel`. Accepts an
 *  undefined list (`photosQuery.data` before load) and renders nothing. */
export function PhotoHero({
  photos,
  apiBaseUrl,
}: {
  photos: PhotoOut[] | undefined;
  apiBaseUrl: string;
}) {
  const { setActive } = useFountainDetailTabs();
  if (photos === undefined) {
    return (
      <View
        style={styles.frame}
        accessibilityLiveRegion="polite"
        accessibilityLabel="Loading fountain photo"
      />
    );
  }
  const newest = heroPhoto(photos);
  if (!newest) return null;
  const count = photos?.length ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={seeAllPhotosLabel(count)}
      onPress={() => setActive("photos")}
      style={styles.wrap}
    >
      <View style={styles.frame}>
        <Image
          source={{ uri: resolvePhotoUrl(apiBaseUrl, newest.url) }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          accessibilityIgnoresInvertColors
        />
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrap: { width: "100%" },
  frame: {
    width: "100%",
    aspectRatio: 1 / ASPECT_RATIO,
    backgroundColor: colors.surface,
    borderRadius: 12,
    overflow: "hidden",
  },
});
