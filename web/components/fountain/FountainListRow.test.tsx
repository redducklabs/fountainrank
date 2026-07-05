// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FountainListRow } from "./FountainListRow";
import type { FountainPin } from "../../lib/fountains";

const base: FountainPin = {
  id: "f1",
  location: { latitude: 37.77, longitude: -122.42 },
  is_working: true,
  rating_count: 3,
  average_rating: 4.5,
};

afterEach(cleanup);

describe("FountainListRow", () => {
  it("renders stars, count, and a See on Map link for a rated fountain", () => {
    render(<FountainListRow fountain={base} />);
    expect(screen.getByRole("img", { name: /Rated 4.5 out of 5/ })).toBeDefined();
    expect(screen.getByText(/3 ratings/)).toBeDefined();
    expect(screen.getByRole("link", { name: /See on Map/i }).getAttribute("href")).toBe(
      "/?flyto=-122.42,37.77&focus=f1",
    );
  });

  it("shows 'Not yet rated' and no stars when unrated", () => {
    render(<FountainListRow fountain={{ ...base, average_rating: null, rating_count: 0 }} />);
    expect(screen.getByText(/Not yet rated/i)).toBeDefined();
    expect(screen.queryByRole("img", { name: /Rated/ })).toBeNull();
  });

  it("renders a lazy-loaded thumbnail prefixed with the API base when thumbnail_url is set", () => {
    render(
      <FountainListRow
        fountain={{ ...base, thumbnail_url: "/api/v1/photos/p1/thumb", photo_count: 2 }}
      />,
    );
    const thumb = screen.getByRole("presentation");
    expect(thumb.tagName).toBe("IMG");
    expect(thumb.getAttribute("alt")).toBe("");
    expect(thumb.getAttribute("loading")).toBe("lazy");
    expect(thumb.getAttribute("src")).toBe("http://localhost:3021/api/v1/photos/p1/thumb");
  });

  it("renders a neutral placeholder (no broken img) when thumbnail_url is null", () => {
    const { container } = render(
      <FountainListRow fountain={{ ...base, thumbnail_url: null, photo_count: 0 }} />,
    );
    expect(container.querySelector("img")).toBeNull();
    const placeholder = container.querySelector('span[aria-hidden="true"]');
    expect(placeholder).not.toBeNull();
    expect(placeholder?.querySelector("svg")).not.toBeNull();
  });

  it("shows a photo count label when photo_count > 0", () => {
    render(
      <FountainListRow
        fountain={{ ...base, thumbnail_url: "/api/v1/photos/p1/thumb", photo_count: 3 }}
      />,
    );
    expect(screen.getByText("3 photos")).toBeDefined();
  });

  it("omits the photo count label when photo_count is 0 or absent", () => {
    render(<FountainListRow fountain={base} />);
    expect(screen.queryByText(/photos?$/)).toBeNull();
  });
});
