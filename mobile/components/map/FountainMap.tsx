import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  type MapProps,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";

import { pinFeatureCollection, type LngLat } from "../../lib/add-fountain/placement";
import { searchMarkerFeatureCollection } from "../../lib/map-search/marker";
import type { RawBounds } from "../../lib/map/bounds";
import {
  ADD_SHEET_CAMERA_PADDING,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  PILL_MIN_ZOOM,
} from "../../lib/map/constants";
import { colors } from "../../theme";

const PIN_IMAGES = {
  "pin-standard": require("../../assets/pins/pin-standard.png"),
  "pin-gold": require("../../assets/pins/pin-gold.png"),
  "pin-broken": require("../../assets/pins/pin-broken.png"),
  "pin-unrated": require("../../assets/pins/pin-unrated.png"),
};

/**
 * A camera fly command. The screen owns ALL camera intent (initial center on the
 * user, the locate button, add-mode placement) and issues it by passing a NEW
 * object — a fresh reference re-fires the fly even to the same target.
 */
export type MapFlyTo = {
  center: LngLat;
  zoom: number;
  /** Reserve bottom space so the target frames above the open add sheet (#100). */
  framedAboveSheet?: boolean;
};

/** Screen position for a map ornament (exactly one of top/bottom and one of left/right). */
export type OrnamentPosition = NonNullable<MapProps["attributionPosition"]>;

type FountainMapProps = {
  styleUrl: string;
  featureCollection: GeoJSON.FeatureCollection;
  flyTo?: MapFlyTo | null;
  showUserLocation: boolean;
  // `userInteraction` (forwarded from the native `onRegionDidChange` event) lets the
  // screen tell a user pan/zoom apart from a programmatic camera fly (e.g. our own
  // `setFlyTo`) - see the search-result marker lifecycle in index.tsx (spec §7.1).
  onRegionChange: (bounds: RawBounds, zoom: number, userInteraction: boolean) => void;
  onPinPress: (id: string) => void;
  /** Cluster tapped: the screen owns the JS cluster index, so it resolves the
   *  expansion zoom and flies the camera (see index.tsx). */
  onClusterPress?: (clusterId: number, center: LngLat) => void;
  draftPin?: LngLat | null;
  /** The transient "searched location" marker (spec §7.1) - its own dedicated,
   *  non-clustered, non-tappable-to-detail source/layer (see index.tsx for the
   *  clear lifecycle via `shouldClearSearchMarker`). */
  searchMarker?: { latitude: number; longitude: number } | null;
  onMapPressForPlacement?: (point: LngLat) => void;
  /** Fires on EVERY map press, independent of add-mode placement - used by the
   *  screen to clear the search-result marker on a plain tap (spec §7.1). */
  onMapPress?: () => void;
  // The screen owns overlay layout + safe-area insets, so it positions the native
  // ornaments to keep them clear of our chips/FAB (#104 attribution, #105 compass).
  attributionPosition?: OrnamentPosition;
  compassPosition?: OrnamentPosition;
};

export function FountainMap({
  styleUrl,
  featureCollection,
  flyTo,
  showUserLocation,
  onRegionChange,
  onPinPress,
  onClusterPress,
  draftPin = null,
  searchMarker = null,
  onMapPressForPlacement,
  onMapPress,
  attributionPosition,
  compassPosition,
}: FountainMapProps) {
  const cameraRef = useRef<CameraRef>(null);

  // Execute a camera fly command. A new `flyTo` object reference (re)issues a fly,
  // so the screen drives the initial user-center, the locate button, and add-mode
  // placement through one path. Null -> no-op (e.g. location denied at startup).
  useEffect(() => {
    if (!flyTo) return;
    cameraRef.current?.flyTo({
      center: [flyTo.center.lng, flyTo.center.lat],
      zoom: flyTo.zoom,
      duration: 600,
      padding: flyTo.framedAboveSheet ? { bottom: ADD_SHEET_CAMERA_PADDING } : undefined,
    });
  }, [flyTo]);

  return (
    <Map
      style={styles.map}
      mapStyle={styleUrl}
      logo={false}
      attribution
      attributionPosition={attributionPosition}
      compassPosition={compassPosition}
      onDidFailLoadingMap={() => {
        // Surface a basemap style / glyph / tile load failure in development; the
        // rest of the app ships no console output.
        if (__DEV__) console.warn("[map] basemap failed to load");
      }}
      onPress={(event) => {
        // Fires on EVERY press (e.g. to clear the search-result marker),
        // independent of - and always before - the add-mode placement below.
        onMapPress?.();
        if (!onMapPressForPlacement) return;
        const [lng, lat] = event.nativeEvent.lngLat;
        onMapPressForPlacement({ lng, lat });
      }}
      onRegionDidChange={(e) => {
        const { bounds, zoom, userInteraction } = e.nativeEvent;
        const [west, south, east, north] = bounds;
        // Default to `false` (programmatic) if the native event ever omits the
        // field, so an unexpected gap fails toward NOT clearing the marker.
        onRegionChange({ west, south, east, north }, zoom, userInteraction ?? false);
      }}
    >
      <Camera ref={cameraRef} initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} />
      <Images
        images={PIN_IMAGES}
        onImageMissing={(e) => {
          // A layer asked for an icon id that was never registered, so those pins
          // would silently not draw — warn in development (see onDidFailLoadingMap).
          // Cluster features carry no `icon` prop, so the symbol layer resolves an
          // empty id for them (they draw as circles, not symbols); that's expected,
          // so only warn for a real, named id.
          if (__DEV__ && e.nativeEvent.image) {
            console.warn(`[map] missing image: ${e.nativeEvent.image}`);
          }
        }}
      />

      <GeoJSONSource
        id="fountains"
        data={featureCollection}
        // Clustering is computed in JS (supercluster, see lib/map/cluster.ts) and fed
        // to this NON-clustered source. Native clustering is broken on this stack
        // (Expo 56 / RN 0.85 / maplibre-react-native 11.3.6, New Architecture):
        // verified on-device, a CLUSTERED GeoJSONSource renders nothing below
        // clusterMaxZoom AND never repaints on a data update, while a non-clustered
        // source renders and updates correctly. The cluster/cluster-count layers
        // below read the supercluster-shaped output (point_count / cluster_id).
        cluster={false}
        onPress={(e) => {
          e.stopPropagation();
          const feature = e.nativeEvent.features?.[0];
          if (!feature) return;
          const props = feature.properties ?? {};
          if (props.cluster) {
            // Cluster tap: hand the id + center to the screen, which owns the JS
            // cluster index and flies to the expansion zoom (see index.tsx).
            const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
            onClusterPress?.(props.cluster_id as number, { lng, lat });
            return;
          }
          if (typeof props.id === "string") onPinPress(props.id);
        }}
      >
        <Layer
          id="clusters"
          source="fountains"
          type="circle"
          filter={["has", "point_count"]}
          paint={{
            "circle-color": "#0C44A0",
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
            "circle-radius": ["step", ["get", "point_count"], 16, 10, 22, 50, 28],
          }}
        />
        <Layer
          id="cluster-count"
          source="fountains"
          type="symbol"
          filter={["has", "point_count"]}
          layout={{
            "text-field": ["get", "point_count_abbreviated"],
            "text-size": 13,
            // #85: the basemap glyph CDN only serves the "Noto Sans Regular" font
            // stack (Bold/Open Sans/Arial Unicode all 404 → labels never draw, as
            // confirmed on-device in Logcat). web/lib/map/layers.ts still requests
            // "Noto Sans Bold" and has the same latent gap; fix there separately.
            "text-font": ["Noto Sans Regular"],
          }}
          paint={{ "text-color": "#ffffff" }}
        />
        <Layer
          id="pins"
          source="fountains"
          type="symbol"
          filter={["!", ["has", "point_count"]]}
          layout={{
            "icon-image": ["get", "icon"],
            "icon-anchor": "bottom",
            "icon-size": 0.5,
            "icon-allow-overlap": true,
          }}
        />
        <Layer
          id="pins-pill"
          source="fountains"
          type="symbol"
          minzoom={PILL_MIN_ZOOM}
          // `has` only checks existence and EVERY feature has a `pill` key (null for
          // unrated). Mirror the web layer's non-null predicate so unrated pins draw
          // no pill.
          filter={["all", ["!", ["has", "point_count"]], ["!=", ["get", "pill"], null]]}
          layout={{
            "text-field": ["get", "pill"],
            "text-size": 12,
            // See cluster-count: an explicit served font is required or the pill
            // labels 404 their glyphs and never render (#85).
            "text-font": ["Noto Sans Regular"],
            "text-anchor": "top",
            "text-offset": [0, 1.2],
            "text-allow-overlap": true,
          }}
          paint={{
            "text-color": colors.brandBlue,
            "text-halo-color": "#ffffff",
            "text-halo-width": 1.5,
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="draft-fountain" data={pinFeatureCollection(draftPin)}>
        <Layer
          id="draft-fountain-pin"
          source="draft-fountain"
          type="symbol"
          layout={{
            "icon-image": "pin-standard",
            "icon-anchor": "bottom",
            // Larger + translucent so the in-progress draft reads as distinct from
            // the solid, full-size saved pins (#99). Raster icons can't be tinted via
            // icon-color, so opacity carries the distinction (no extra asset needed).
            "icon-size": 0.72,
            "icon-allow-overlap": true,
          }}
          paint={{ "icon-opacity": 0.6 }}
        />
      </GeoJSONSource>

      {/* Transient "searched location" marker (spec §7.1). Its own dedicated,
          non-clustered source/layer - distinct from `fountains`/`draft-fountain` - so
          it's never mistaken for a fountain: no `onPress` here, so a tap on it falls
          through to the Map-level `onPress` above (which clears it, see index.tsx)
          instead of resolving to a fountain detail. A plain CircleLayer needs no new
          image asset and reads clearly as "not a fountain pin". */}
      <GeoJSONSource id="search-result" data={searchMarkerFeatureCollection(searchMarker)}>
        <Layer
          id="search-result-marker"
          source="search-result"
          type="circle"
          paint={{
            "circle-radius": 10,
            "circle-color": colors.danger,
            "circle-stroke-color": "#ffffff",
            "circle-stroke-width": 3,
          }}
        />
      </GeoJSONSource>

      {showUserLocation ? <UserLocation /> : null}
    </Map>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
