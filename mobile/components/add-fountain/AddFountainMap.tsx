import {
  Camera,
  type CameraRef,
  GeoJSONSource,
  Images,
  Layer,
  Map,
  UserLocation,
} from "@maplibre/maplibre-react-native";
import { useEffect, useMemo, useRef } from "react";
import { StyleSheet } from "react-native";

import type { RawBounds } from "../../lib/map/bounds";
import {
  DEFAULT_CENTER,
  DEFAULT_ZOOM,
  NEIGHBORHOOD_ZOOM,
  PLACE_MIN_ZOOM,
} from "../../lib/map/constants";
import { colors } from "../../theme";
import {
  pinFeatureCollection,
  ringFeatureCollection,
  type Bound,
  type LngLat,
} from "../../lib/add-fountain/placement";

const PIN_IMAGES = {
  "pin-standard": require("../../assets/pins/pin-standard.png"),
};

export function AddFountainMap({
  styleUrl,
  userCoords,
  showUserLocation,
  bound,
  pin,
  onRegionChange,
  onPlace,
}: {
  styleUrl: string;
  userCoords?: { latitude: number; longitude: number } | null;
  showUserLocation: boolean;
  bound: Bound | null;
  pin: LngLat | null;
  onRegionChange: (bounds: RawBounds, zoom: number) => void;
  onPlace: (point: LngLat) => void;
}) {
  const cameraRef = useRef<CameraRef>(null);
  const ring = useMemo(() => ringFeatureCollection(bound), [bound]);
  const pinFc = useMemo(() => pinFeatureCollection(pin), [pin]);

  useEffect(() => {
    if (!userCoords) return;
    cameraRef.current?.flyTo({
      center: [userCoords.longitude, userCoords.latitude],
      zoom: Math.max(NEIGHBORHOOD_ZOOM, PLACE_MIN_ZOOM),
      duration: 600,
    });
  }, [userCoords]);

  return (
    <Map
      style={styles.map}
      mapStyle={styleUrl}
      logo={false}
      attribution
      onPress={(event) => {
        const [lng, lat] = event.nativeEvent.lngLat;
        onPlace({ lng, lat });
      }}
      onRegionDidChange={(event) => {
        const { bounds, zoom } = event.nativeEvent;
        const [west, south, east, north] = bounds;
        onRegionChange({ west, south, east, north }, zoom);
      }}
    >
      <Camera ref={cameraRef} initialViewState={{ center: DEFAULT_CENTER, zoom: DEFAULT_ZOOM }} />
      <Images images={PIN_IMAGES} />

      <GeoJSONSource id="add-bound" data={ring}>
        <Layer
          id="add-bound-ring"
          source="add-bound"
          type="line"
          paint={{
            "line-color": colors.brandBlue,
            "line-width": 2,
            "line-opacity": 0.45,
            "line-dasharray": [2, 2],
          }}
        />
      </GeoJSONSource>

      <GeoJSONSource id="add-pin" data={pinFc}>
        <Layer
          id="add-pin-layer"
          source="add-pin"
          type="symbol"
          layout={{
            "icon-image": "pin-standard",
            "icon-anchor": "bottom",
            "icon-size": 0.58,
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
