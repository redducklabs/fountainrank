// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

const { push, searchGeocode } = vi.hoisted(() => ({
  push: vi.fn(),
  searchGeocode: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));
vi.mock("../lib/search/geocode-client", () => ({
  searchGeocode,
  mapGeocodeError: () => "unavailable" as const,
}));

import { HeaderSearch } from "./HeaderSearch";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function typeQuery(text: string) {
  const input = screen.getByRole("combobox", { name: /search address or city/i });
  fireEvent.change(input, { target: { value: text } });
  return input;
}

describe("HeaderSearch", () => {
  it("renders a labeled input with no dropdown initially", () => {
    render(<HeaderSearch />);
    expect(screen.getByRole("combobox", { name: /search address or city/i })).toBeInTheDocument();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("does not search below the 3-character minimum", () => {
    render(<HeaderSearch />);
    typeQuery("ab");
    expect(searchGeocode).not.toHaveBeenCalled();
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("debounces, calls the public geocode client, and shows results with the persistent attribution", async () => {
    searchGeocode.mockResolvedValue([{ id: "1", label: "123 Main St", latitude: 1, longitude: 2 }]);
    render(<HeaderSearch />);
    typeQuery("main st");

    await waitFor(() => expect(searchGeocode).toHaveBeenCalledTimes(1), { timeout: 1000 });
    expect(searchGeocode).toHaveBeenCalledWith({ q: "main st" }, expect.anything());
    await waitFor(() =>
      expect(screen.getByRole("option", { name: /123 main st/i })).toBeInTheDocument(),
    );
    const attribution = screen.getByRole("link", { name: /search by locationiq/i });
    expect(attribution).toHaveAttribute("href", "https://locationiq.com/attribution");
  });

  it("shows the single unavailable error state on failure", async () => {
    searchGeocode.mockRejectedValue(new Error("boom"));
    render(<HeaderSearch />);
    typeQuery("failville");

    await waitFor(
      () => expect(screen.getByRole("alert")).toHaveTextContent(/unavailable right now/i),
      { timeout: 1000 },
    );
  });

  it("shows no-matches on an empty result set", async () => {
    searchGeocode.mockResolvedValue([]);
    render(<HeaderSearch />);
    typeQuery("nowhereville");

    await waitFor(() => expect(screen.getByText(/no matches/i)).toBeInTheDocument(), {
      timeout: 1000,
    });
  });

  it("selecting a result pushes the flyto/bbox query and closes the dropdown", async () => {
    searchGeocode.mockResolvedValue([
      {
        id: "1",
        label: "Somewhere",
        latitude: 10,
        longitude: 20,
        boundingBox: { south: 9, west: 19, north: 11, east: 21 },
      },
    ]);
    render(<HeaderSearch />);
    typeQuery("somewhere");
    const option = await waitFor(() => screen.getByRole("option", { name: /somewhere/i }), {
      timeout: 1000,
    });

    fireEvent.click(option);

    expect(push).toHaveBeenCalledWith("/?flyto=20,10&bbox=19,9,21,11");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("Escape closes the dropdown without clearing the query", async () => {
    searchGeocode.mockResolvedValue([{ id: "1", label: "Somewhere", latitude: 1, longitude: 2 }]);
    render(<HeaderSearch />);
    const input = typeQuery("somewhere");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument(), {
      timeout: 1000,
    });

    fireEvent.keyDown(input, { key: "Escape" });

    expect(screen.queryByRole("listbox")).toBeNull();
    expect(input).toHaveValue("somewhere");
  });

  it("closes the dropdown on an outside click", async () => {
    searchGeocode.mockResolvedValue([{ id: "1", label: "Somewhere", latitude: 1, longitude: 2 }]);
    render(<HeaderSearch />);
    typeQuery("somewhere");
    await waitFor(() => expect(screen.getByRole("listbox")).toBeInTheDocument(), {
      timeout: 1000,
    });

    fireEvent.mouseDown(document.body);

    expect(screen.queryByRole("listbox")).toBeNull();
  });
});
