import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  type GeoJSONSourceRef,
  Images,
  Layer,
  Map,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import { useEffect, useRef } from "react";
import { StyleSheet } from "react-native";

import { pinFeatureCollection, type LngLat } from "../../lib/add-fountain/placement";
import type { RawBounds } from "../../lib/map/bounds";
import {
  CLUSTER_MAX_ZOOM,
  CLUSTER_RADIUS,
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  INITIAL_USER_ZOOM,
  PILL_MIN_ZOOM,
} from "../../lib/map/constants";
import { colors } from "../../theme";

const PIN_IMAGES = {
  "pin-standard": require("../../assets/pins/pin-standard.png"),
  "pin-gold": require("../../assets/pins/pin-gold.png"),
  "pin-broken": require("../../assets/pins/pin-broken.png"),
};

type FountainMapProps = {
  styleUrl: string;
  featureCollection: GeoJSON.FeatureCollection;
  userCoords?: { latitude: number; longitude: number } | null;
  /** Bump from the screen's locate button to re-center on the user on demand. */
  recenterKey?: number;
  recenterZoom?: number;
  showUserLocation: boolean;
  onRegionChange: (bounds: RawBounds, zoom: number) => void;
  onPinPress: (id: string) => void;
  draftPin?: LngLat | null;
  onMapPressForPlacement?: (point: LngLat) => void;
};

export function FountainMap({
  styleUrl,
  featureCollection,
  userCoords,
  recenterKey = 0,
  recenterZoom,
  showUserLocation,
  onRegionChange,
  onPinPress,
  draftPin = null,
  onMapPressForPlacement,
}: FountainMapProps) {
  const cameraRef = useRef<CameraRef>(null);
  const sourceRef = useRef<GeoJSONSourceRef>(null);

  // Center on the user when coords FIRST arrive (they resolve after first render,
  // so initialViewState cannot) and again whenever the locate button bumps
  // recenterKey. No coords -> no-op (denial is non-blocking).
  useEffect(() => {
    if (!userCoords) return;
    cameraRef.current?.flyTo({
      center: [userCoords.longitude, userCoords.latitude],
      zoom: recenterZoom ?? INITIAL_USER_ZOOM,
      duration: 600,
    });
  }, [userCoords, recenterKey, recenterZoom]);

  return (
    <Map
      style={styles.map}
      mapStyle={styleUrl}
      logo={false}
      attribution
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
      <Images images={PIN_IMAGES} />

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
            "icon-size": 0.62,
            "icon-allow-overlap": true,
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
