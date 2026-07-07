import type { components } from "@fountainrank/api-client";

type PhotoOut = components["schemas"]["PhotoOut"];

/** The single hero photo for the Info tab: the newest one (the list is `created_at desc`),
 *  or null when there are none. Tolerates an undefined list (`photosQuery.data` before load). */
export function heroPhoto(photos: PhotoOut[] | undefined): PhotoOut | null {
  return photos && photos.length > 0 ? photos[0] : null;
}

/** Photos tab label — a count suffix only when non-empty (matches web `FountainDetail`). */
export function photosTabLabel(count: number): string {
  return count > 0 ? `Photos (${count})` : "Photos";
}

/** Accessible label for the Info hero (opens the full set on the Photos tab). */
export function seeAllPhotosLabel(count: number): string {
  return `See all ${count} photo${count === 1 ? "" : "s"}`;
}
