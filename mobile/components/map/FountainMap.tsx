import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  type GeoJSONSourceRef,
  Images,
  Layer,
  Map,
  type MapProps,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";

import { pinFeatureCollection, type LngLat } from "../../lib/add-fountain/placement";
import type { RawBounds } from "../../lib/map/bounds";
import {
  ADD_SHEET_CAMERA_PADDING,
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  PILL_MIN_ZOOM,
} from "../../lib/map/constants";
import { colors } from "../../theme";

const PIN_IMAGES = {
  "pin-standard": require("../../assets/pins/pin-standard.png"),
  "pin-gold": require("../../assets/pins/pin-gold.png"),
  "pin-broken": require("../../assets/pins/pin-broken.png"),
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
  onRegionChange: (bounds: RawBounds, zoom: number) => void;
  onPinPress: (id: string) => void;
  draftPin?: LngLat | null;
  onMapPressForPlacement?: (point: LngLat) => void;
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
  draftPin = null,
  onMapPressForPlacement,
  attributionPosition,
  compassPosition,
}: FountainMapProps) {
  const cameraRef = useRef<CameraRef>(null);
  const sourceRef = useRef<GeoJSONSourceRef>(null);

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

  // #85 instrumentation: how many features the JS side handed to the native
  // GeoJSONSource. If pins are missing on a device while this logs a non-zero
  // count, the data is not reaching the native source (the leading Android-empty
  // theory under the new architecture). Dev-only so production stays quiet; read
  // it from Metro/Logcat on a development build.
  useEffect(() => {
    if (__DEV__) {
      console.log(`[map] featureCollection features=${featureCollection.features.length} (#85)`);
    }
  }, [featureCollection]);

  return (
    <Map
      style={styles.map}
      mapStyle={styleUrl}
      logo={false}
      attribution
      attributionPosition={attributionPosition}
      compassPosition={compassPosition}
      onDidFailLoadingMap={() => {
        // #85: a basemap style / glyph / tile load failure surfaces here. Dev-only
        // (the rest of the app ships no console): reproduce on a development build —
        // same new architecture — and watch Logcat/Metro when the map renders blank.
        if (__DEV__) console.warn("[map] basemap failed to load (#85)");
      }}
      onPress={(event) => {
        if (!onMapPressForPlacement) return;
        const [lng, lat] = event.nativeEvent.lngLat;
        onMapPressForPlacement({ lng, lat });
      }}
      onRegionDidChange={(e) => {
        const { bounds, zoom } = e.nativeEvent;
        const [west, south, east, north] = bounds;
        onRegionChange({ west, south, east, north }, zoom);
      }}
    >
      <Camera ref={cameraRef} initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} />
      <Images
        images={PIN_IMAGES}
        onImageMissing={(e) => {
          // #85: a layer asked for an icon id that was never registered, so those
          // pins silently do not draw. Dev-only (see onDidFailLoadingMap).
          if (__DEV__) console.warn(`[map] missing image: ${e.nativeEvent.image} (#85)`);
        }}
      />

      <GeoJSONSource
        ref={sourceRef}
        id="fountains"
        data={featureCollection}
        cluster
        clusterRadius={CLUSTER_RADIUS}
        clusterMaxZoom={CLUSTER_MAX_ZOOM}
        onPress={(e) => {
          e.stopPropagation();
          const feature = e.nativeEvent.features?.[0];
          if (!feature) return;
          const props = feature.properties ?? {};
          if (props.cluster) {
            // Cluster: expand to the zoom that breaks it apart, centered on it.
            const [lng, lat] = (feature.geometry as GeoJSON.Point).coordinates;
            void sourceRef.current
              ?.getClusterExpansionZoom(props.cluster_id as number)
              .then((zoom) => cameraRef.current?.flyTo({ center: [lng, lat], zoom, duration: 400 }))
              .catch(() => undefined);
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
            // Without an explicit text-font MapLibre requests Open Sans / Arial
            // Unicode, which the basemap glyph CDN 404s, so cluster counts never
            // drew (#85). Mirror the web layer's proven font (it renders today).
            "text-font": ["Noto Sans Bold"],
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
            "text-font": ["Noto Sans Bold"],
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

      {showUserLocation ? <UserLocation /> : null}
    </Map>
  );
}

const styles = StyleSheet.create({
  map: { flex: 1 },
});
