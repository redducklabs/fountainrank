// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

vi.mock("../lib/server/viewer", () => ({ getViewer: vi.fn(async () => ({ state: "anonymous" })) }));
vi.mock("./AuthControl", () => ({ AuthControl: () => <div data-testid="auth-control" /> }));

import { SiteHeader } from "./SiteHeader";

afterEach(cleanup);

describe("SiteHeader", () => {
  it("hero variant shows the tagline", async () => {
    render(await SiteHeader({ variant: "hero" }));
    expect(screen.getByText(/find a drinking fountain near you/i)).toBeTruthy();
    expect(screen.getByTestId("auth-control")).toBeTruthy();
  });

  it("bar variant has no tagline", async () => {
    render(await SiteHeader({ variant: "bar" }));
    expect(screen.queryByText(/find a drinking fountain near you/i)).toBeNull();
  });
});
