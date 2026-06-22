// @vitest-environment jsdom
import { render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const getDetail = vi.fn();
const getNotes = vi.fn();
const logFn = vi.fn();
const notFoundFn = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});

vi.mock("../../../lib/fountains", () => ({
  getFountainDetailServer: (...a: unknown[]) => getDetail(...a),
  getFountainNotesServer: (...a: unknown[]) => getNotes(...a),
}));
vi.mock("../../../lib/server/log", () => ({ log: (...a: unknown[]) => logFn(...a) }));
vi.mock("next/navigation", () => ({ notFound: () => notFoundFn() }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => (
    <a href={href}>{children}</a>
  ),
}));
vi.mock("../../../components/fountain/FountainDetail", () => ({
  FountainDetail: ({ notes }: { notes: unknown[] }) => (
    <div data-testid="detail">notes:{notes.length}</div>
  ),
}));

import FountainPage from "./page";

const params = Promise.resolve({ id: "f1" });

beforeEach(() => {
  getDetail.mockReset();
  getNotes.mockReset();
  logFn.mockReset();
  notFoundFn.mockClear();
});

describe("FountainPage route (standalone)", () => {
  it("passes fetched notes through to the detail on success", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: [{ id: "n1" }, { id: "n2" }], status: 200 });
    render(await FountainPage({ params }));
    expect(screen.getByTestId("detail")).toHaveTextContent("notes:2");
    expect(logFn).not.toHaveBeenCalled();
  });
  it("non-fatal notes: 503 renders detail with notes=[] and a constrained warn log", async () => {
    getDetail.mockResolvedValue({ data: { id: "f1" }, status: 200 });
    getNotes.mockResolvedValue({ data: undefined, status: 503 });
    render(await FountainPage({ params }));
    expect(screen.getByTestId("detail")).toHaveTextContent("notes:0");
    expect(logFn).toHaveBeenCalledWith("warn", expect.stringMatching(/notes/i), {
      requestId: expect.any(String),
      id: "f1",
      status: 503,
    });
  });
  it("detail 404 calls notFound() and does not render the detail", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 404 });
    getNotes.mockResolvedValue({ data: [], status: 200 });
    await expect(FountainPage({ params })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundFn).toHaveBeenCalled();
  });
  it("detail network failure (!data) renders the error UI, not a blank/crash", async () => {
    getDetail.mockResolvedValue({ data: undefined, status: 0 });
    getNotes.mockResolvedValue({ data: undefined, status: 0 });
    render(await FountainPage({ params }));
    expect(screen.getByText(/Couldn.t load this fountain/i)).toBeInTheDocument();
  });
});
