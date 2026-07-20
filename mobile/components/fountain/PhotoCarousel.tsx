import type { components } from "@fountainrank/api-client";
import { Image } from "expo-image";
import { useCallback, useState } from "react";
import type { ListRenderItemInfo, ViewToken } from "react-native";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";

import {
  clampPhotoIndex,
  resolvePhotoUrl,
  shouldShowDeleteControl,
} from "../../lib/detail/photo-carousel";
import { colors, spacing, typography } from "../../theme";

type PhotoOut = components["schemas"]["PhotoOut"];

const ASPECT_RATIO = 3 / 4; // height = width * ASPECT_RATIO, matching the web 4:3 carousel
const VIEWABILITY_CONFIG = { itemVisiblePercentThreshold: 60 };

export function PhotoCarousel({
  photos,
  apiBaseUrl,
  onReport,
  onDelete,
}: {
  photos: PhotoOut[];
  apiBaseUrl: string;
  onReport?: (photo: PhotoOut) => void;
  onDelete?: (photo: PhotoOut) => void;
}) {
  const [width, setWidth] = useState(0);
  const [activeIndex, setActiveIndex] = useState(0);

  // FlatList's `pagingEnabled` gives native, gesture-handler-free horizontal swipe; track
  // which page is currently visible via the viewability callback rather than reanimated.
  const onViewableItemsChanged = useCallback(
    ({ viewableItems }: { viewableItems: ViewToken[] }) => {
      const first = viewableItems.find((v) => v.isViewable);
      if (first?.index != null) setActiveIndex(first.index);
    },
    [],
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<PhotoOut>) => (
      <View style={[styles.page, { width, height: width * ASPECT_RATIO }]}>
        <Image
          source={{ uri: resolvePhotoUrl(apiBaseUrl, item.url) }}
          style={StyleSheet.absoluteFill}
          contentFit="cover"
          transition={200}
          accessibilityIgnoresInvertColors
        />
      </View>
    ),
    [apiBaseUrl, width],
  );

  if (photos.length === 0) return null;

  // Guard against a stale `activeIndex` when `photos` shrinks (e.g. after an owner delete
  // or an admin hide hands back a shorter list) — never dereference `photos[index]` out of
  // bounds, mirroring the web carousel's render-time clamp.
  const safeIndex = clampPhotoIndex(activeIndex, photos.length);
  const current = photos[safeIndex];

  return (
    <View style={styles.wrap} onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <FlatList
        data={photos}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        keyExtractor={(p) => p.id}
        renderItem={renderItem}
        onViewableItemsChanged={onViewableItemsChanged}
        viewabilityConfig={VIEWABILITY_CONFIG}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        testID="photo-carousel-list"
      />

      {photos.length > 1 && (
        <View
          style={styles.dots}
          accessibilityElementsHidden
          importantForAccessibility="no-hide-descendants"
        >
          {photos.map((p, i) => (
            <View
              key={p.id}
              testID="photo-carousel-dot"
              style={[styles.dot, i === safeIndex && styles.dotActive]}
            />
          ))}
        </View>
      )}

      {(onReport || shouldShowDeleteControl(current, Boolean(onDelete))) && (
        <View style={styles.actions}>
          {onReport && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Report this photo"
              onPress={() => onReport(current)}
              style={styles.actionButton}
            >
              <Text style={styles.actionTextMuted}>Report</Text>
            </Pressable>
          )}
          {shouldShowDeleteControl(current, Boolean(onDelete)) && (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Delete this photo"
              onPress={() => onDelete?.(current)}
              style={styles.actionButton}
            >
              <Text style={styles.actionTextDanger}>Delete</Text>
            </Pressable>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.sm },
  page: { backgroundColor: colors.surface, overflow: "hidden", borderRadius: 12 },
  dots: { flexDirection: "row", justifyContent: "center", gap: spacing.xs },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.border },
  dotActive: { backgroundColor: colors.brandBlue },
  actions: { flexDirection: "row", justifyContent: "flex-end", gap: spacing.sm },
  actionButton: {
    backgroundColor: colors.surface,
    borderColor: colors.border,
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  actionTextMuted: { ...typography.meta, fontWeight: "700", color: colors.textMuted },
  actionTextDanger: { ...typography.meta, fontWeight: "700", color: colors.danger },
});
