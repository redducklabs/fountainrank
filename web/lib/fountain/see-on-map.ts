// Deep link to the main map (`/`) that flies the camera to a fountain and highlights it.
// `flyto=lng,lat` is the existing validated map contract (see web/lib/search/flyto.ts); `focus`
// is the fountain id the map draws its selected halo on (see web/lib/map/active-id.ts).
export function seeOnMapHref(f: { id: string; lng: number; lat: number }): string {
  return `/?flyto=${f.lng},${f.lat}&focus=${encodeURIComponent(f.id)}`;
}
