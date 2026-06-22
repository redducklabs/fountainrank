// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../components/SiteHeader", () => ({
  SiteHeader: () => <div data-testid="site-header" />,
}));
vi.mock("../components/map/MapBrowserLoader", () => ({ default: () => <div data-testid="map" /> }));

import Home from "./page";

afterEach(cleanup);

it("renders the site header and no footer sign-in link", () => {
  render(<Home />);
  expect(screen.getByTestId("site-header")).toBeTruthy();
  expect(screen.queryByText(/^sign in$/i)).toBeNull();
});
