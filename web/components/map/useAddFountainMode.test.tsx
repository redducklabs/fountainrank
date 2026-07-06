// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlacementMap } from "./placement-map";

const {
  addFountain,
  replace,
  push,
  signInWithReturn,
  fetchRatingTypes,
  fetchAttributeTypes,
  buildAttributeGroups,
} = vi.hoisted(() => ({
  addFountain: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
  signInWithReturn: vi.fn(),
  fetchRatingTypes: vi.fn(),
  fetchAttributeTypes: vi.fn(),
  buildAttributeGroups: vi.fn(),
}));
vi.mock("../../app/actions/add-fountain", () => ({ addFountain }));
vi.mock("../../app/actions/auth", () => ({ signInWithReturn }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace, push }) }));
vi.mock("../../lib/catalog", () => ({
  fetchRatingTypes,
  fetchAttributeTypes,
  buildAttributeGroups,
}));

import { useAddFountainMode } from "./useAddFountainMode";

function makeFakeMap(zoom = 17) {
  const calls = {
    pin: [] as ({ lng: number; lat: number } | null)[],
    ring: [] as unknown[],
    flyTo: [] as unknown[],
    unsub: 0,
    torn: 0,
  };
  let onClick: ((p: { lng: number; lat: number }) => void) | null = null;
  let onMoveEnd: (() => void) | null = null;
  const map: PlacementMap = {
    getZoom: () => zoom,
    getCenter: () => ({ lng: -122.3, lat: 47.6 }),
    getViewport: () => ({ west: -122.305, south: 47.598, east: -122.295, north: 47.602 }),
    flyToFix: (c) => calls.flyTo.push(c),
    subscribe: (h) => {
      onClick = h.onClick;
      onMoveEnd = h.onMoveEnd;
      return () => {
        calls.unsub++;
      };
    },
    setPin: (p) => calls.pin.push(p),
    setRing: (b) => calls.ring.push(b),
    reinstall: () => {},
    teardown: () => {
      calls.torn++;
    },
  };
  return {
    map,
    calls,
    click: (p: { lng: number; lat: number }) => onClick?.(p),
    move: () => onMoveEnd?.(),
  };
}

function Harness({
  map,
  opts,
}: {
  map: PlacementMap | null;
  opts: Parameters<typeof useAddFountainMode>[1];
}) {
  const { fab, panel } = useAddFountainMode(map, opts);
  return (
    <div>
      {fab}
      {panel}
    </div>
  );
}

const geo = { getCurrentPosition: vi.fn() };
beforeEach(() => {
  Object.defineProperty(global.navigator, "geolocation", { value: geo, configurable: true });
  // Default: empty catalogs (no optional controls). Individual tests override with fixtures.
  fetchRatingTypes.mockReset().mockResolvedValue([]);
  fetchAttributeTypes.mockReset().mockResolvedValue([]);
  buildAttributeGroups.mockReset().mockReturnValue([]);
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("useAddFountainMode", () => {
  it("FAB is null when WebGL is unavailable", () => {
    const { map } = makeFakeMap();
    render(
      <Harness
        map={map}
        opts={{ isAuthenticated: true, webglOk: false, autoEnter: false, hadAddParam: false }}
      />,
    );
    expect(screen.queryByRole("button", { name: /add a fountain/i })).toBeNull();
  });

  it("entering requests geolocation and shows the placing panel", () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    const { map } = makeFakeMap();
    render(
      <Harness
        map={map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    expect(geo.getCurrentPosition).toHaveBeenCalled();
    expect(screen.getByRole("dialog", { name: /add a fountain/i })).toBeTruthy();
    // no GPS -> fallback copy
    expect(screen.getByText(/couldn.t confirm your location/i)).toBeTruthy();
  });

  it("ignores a map click below PLACE_MIN_ZOOM (gated drop)", () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    const low = makeFakeMap(10);
    render(
      <Harness
        map={low.map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => low.click({ lng: -122.3, lat: 47.6 }));
    expect(screen.getByText(/drop a pin to set the location/i)).toBeTruthy(); // no pin (gated)
  });

  it("drops a pin on a map click at street zoom", () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    const ok = makeFakeMap(17);
    render(
      <Harness
        map={ok.map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    expect(screen.getByText(/lat 47\.6/i)).toBeTruthy(); // pin coord readout
  });

  it("auto-enters and strips ?add=1 when authed", () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    const { map } = makeFakeMap();
    render(
      <Harness
        map={map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: true, hadAddParam: true }}
      />,
    );
    expect(screen.getByRole("dialog", { name: /add a fountain/i })).toBeTruthy();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("strips ?add=1 without entering when anonymous", () => {
    const { map } = makeFakeMap();
    render(
      <Harness
        map={map}
        opts={{ isAuthenticated: false, webglOk: true, autoEnter: false, hadAddParam: true }}
      />,
    );
    expect(screen.queryByRole("dialog", { name: /add a fountain/i })).toBeNull();
    expect(replace).toHaveBeenCalledWith("/");
  });

  it("submit success navigates to the new fountain", async () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    addFountain.mockResolvedValue({ ok: true, fountainId: "new-1" });
    const ok = makeFakeMap(17);
    render(
      <Harness
        map={ok.map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add fountain/i }));
    });
    expect(addFountain).toHaveBeenCalledWith(
      expect.objectContaining({
        location: { latitude: 47.6, longitude: -122.3 },
        is_working: true,
      }),
    );
    expect(push).toHaveBeenCalledWith("/fountains/new-1");
    // add-mode resets after navigating so the home map isn't stranded under the detail modal
    expect(screen.queryByRole("dialog", { name: /add a fountain/i })).toBeNull();
    expect(screen.getByRole("button", { name: /add a fountain/i })).toBeTruthy();
  });

  it("freezes a placed pin: a moveend (pan/zoom) does not rewrite it", () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    const ok = makeFakeMap(17);
    render(
      <Harness
        map={ok.map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    expect(screen.getByText(/lat 47\.60000/i)).toBeTruthy();
    act(() => ok.move()); // pan/zoom must NOT silently move the placed pin
    expect(screen.getByText(/lat 47\.60000/i)).toBeTruthy();
  });

  it("submit duplicate shows the View it link", async () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    addFountain.mockResolvedValue({ ok: false, error: "duplicate", fountainId: "dup-9" });
    const ok = makeFakeMap(17);
    render(
      <Harness
        map={ok.map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add fountain/i }));
    });
    expect(screen.getByRole("link", { name: /view it/i }).getAttribute("href")).toBe(
      "/fountains/dup-9",
    );
  });

  it("defers stripping ?add=1 until the map exists, then enters exactly once", () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    const { map } = makeFakeMap();
    const opts = { isAuthenticated: true, webglOk: true, autoEnter: true, hadAddParam: true };
    const { rerender } = render(<Harness map={null} opts={opts} />);
    expect(replace).not.toHaveBeenCalled(); // no map yet -> keep the param
    expect(screen.queryByRole("dialog", { name: /add a fountain/i })).toBeNull();
    rerender(<Harness map={map} opts={opts} />);
    expect(screen.getByRole("dialog", { name: /add a fountain/i })).toBeTruthy();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("treats poor-accuracy GPS as no usable fix (fallback, no recenter)", () => {
    geo.getCurrentPosition.mockImplementation(
      (ok: (pos: { coords: { latitude: number; longitude: number; accuracy: number } }) => void) =>
        ok({ coords: { latitude: 47.6, longitude: -122.3, accuracy: 5000 } }),
    );
    const { map, calls } = makeFakeMap();
    render(
      <Harness
        map={map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    expect(calls.flyTo).toHaveLength(0);
    expect(screen.getByText(/couldn.t confirm your location/i)).toBeTruthy();
  });

  it("submits selected ratings + observations (unknown excluded) from the rendered controls", async () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    addFountain.mockResolvedValue({ ok: true, fountainId: "new-2" });
    fetchRatingTypes.mockResolvedValue([
      { id: 11, name: "Coldness", description: "", sort_order: 0 },
    ]);
    fetchAttributeTypes.mockResolvedValue([{ id: 0 }]); // content irrelevant; buildAttributeGroups mocked
    buildAttributeGroups.mockReturnValue([
      {
        category: "physical",
        controls: [
          {
            id: 5,
            key: "filler",
            name: "Bottle filler",
            description: "",
            kind: "boolean",
            options: ["yes", "no", "unknown"],
          },
          {
            id: 6,
            key: "dog",
            name: "Dog bowl",
            description: "",
            kind: "boolean",
            options: ["yes", "no", "unknown"],
          },
        ],
      },
    ]);
    const ok = makeFakeMap(17);
    render(
      <Harness
        map={ok.map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    // catalog fetch resolves async -> wait for the rating control, then pick a star + one attribute
    fireEvent.click(await screen.findByRole("radio", { name: /coldness: 4 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: /more details/i }));
    fireEvent.click(screen.getByRole("radio", { name: /bottle filler: yes/i }));
    // "Dog bowl" stays at its default (unknown) -> must be excluded from the payload
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add fountain/i }));
    });
    expect(addFountain).toHaveBeenCalledWith(
      expect.objectContaining({
        location: { latitude: 47.6, longitude: -122.3 },
        is_working: true,
        ratings: [{ rating_type_id: 11, stars: 4 }],
        observations: [{ attribute_type_id: 5, value: "yes" }],
      }),
    );
    expect(push).toHaveBeenCalledWith("/fountains/new-2");
  });

  it("clears optional fields between adds (no stale carryover)", async () => {
    geo.getCurrentPosition.mockImplementation((_ok: unknown, err: (e: { code: number }) => void) =>
      err({ code: 1 }),
    );
    addFountain.mockResolvedValue({ ok: false, error: "server" }); // stay in the flow (no navigate)
    fetchRatingTypes.mockResolvedValue([
      { id: 11, name: "Coldness", description: "", sort_order: 0 },
    ]);
    const ok = makeFakeMap(17);
    render(
      <Harness
        map={ok.map}
        opts={{ isAuthenticated: true, webglOk: true, autoEnter: false, hadAddParam: false }}
      />,
    );
    // First add: place -> details -> set a rating -> cancel
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.3, lat: 47.6 }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    fireEvent.click(await screen.findByRole("radio", { name: /coldness: 4 stars/i }));
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));
    // Second add: place -> details -> submit WITHOUT touching the rating
    fireEvent.click(screen.getByRole("button", { name: /add a fountain/i }));
    act(() => ok.click({ lng: -122.31, lat: 47.61 }));
    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await screen.findByRole("radio", { name: /coldness: 1 star$/i }); // controls present again
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /add fountain/i }));
    });
    const lastCall = addFountain.mock.calls.at(-1)?.[0];
    expect(lastCall.ratings).toBeUndefined();
    expect(lastCall.observations).toBeUndefined();
  });
});
