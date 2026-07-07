// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../lib/api", () => ({ resolveApiBaseUrl: () => "http://api" }));

import { PhotoHero } from "./PhotoHero";
import { FountainDetailTabs } from "./FountainDetailTabs";
import type { PhotoOut } from "../../lib/fountains";

afterEach(cleanup);

function photo(id: string): PhotoOut {
  return {
    id,
    url: `/api/v1/photos/${id}`,
    thumbnail_url: `/api/v1/photos/${id}/thumb`,
    width: 800,
    height: 600,
    uploaded_by: null,
    created_at: "2026-07-07T00:00:00Z",
    is_own: false,
  };
}

// Render the hero inside a real FountainDetailTabs so it reads the actual tab context
// (no module mock) — the Info tab is active by default, and the Photos tab carries a marker.
function renderInTabs(photos: PhotoOut[]) {
  return render(
    <FountainDetailTabs
      tabs={[
        { id: "primary", label: "Info", content: <PhotoHero photos={photos} /> },
        { id: "details", label: "Details", content: <span>details-panel</span> },
        { id: "photos", label: "Photos", content: <span>photos-panel</span> },
      ]}
    />,
  );
}

describe("PhotoHero (web)", () => {
  it("renders nothing when there are no photos", () => {
    renderInTabs([]);
    expect(screen.queryByRole("button", { name: /see all/i })).toBeNull();
  });

  it("renders the newest photo (photos[0]) with the resolved API url", () => {
    const { container } = renderInTabs([photo("a"), photo("b")]);
    expect(container.querySelector("img")?.getAttribute("src")).toBe("http://api/api/v1/photos/a");
  });

  it("has a pluralized see-all label", () => {
    renderInTabs([photo("a"), photo("b")]);
    expect(screen.getByRole("button", { name: "See all 2 photos" })).toBeTruthy();
  });

  it("switches to the Photos tab when activated", () => {
    renderInTabs([photo("a")]);
    fireEvent.click(screen.getByRole("button", { name: "See all 1 photo" }));
    expect(screen.getByRole("tab", { name: "Photos" }).getAttribute("aria-selected")).toBe("true");
  });
});
