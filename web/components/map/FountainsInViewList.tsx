/**
 * PLACEHOLDER — Task 14 will replace this with the real accessible fountain list.
 * This file exists only so MapBrowser can import it without a missing-module error.
 * Do NOT implement behaviour here; Task 14 owns this file.
 */
import type { FountainPin } from "../../lib/fountains";

export interface FountainsInViewListProps {
  pins: FountainPin[];
  activeId: string;
  onOpen: (id: string) => void;
}

export function FountainsInViewList(_props: FountainsInViewListProps) {
  // Intentionally renders nothing — replaced by Task 14.
  return null;
}
