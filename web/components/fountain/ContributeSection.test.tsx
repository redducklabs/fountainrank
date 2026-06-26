// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const { signInWithReturn, submitRating, submitCondition, submitNote, submitAttributes, refresh } =
  vi.hoisted(() => ({
    signInWithReturn: vi.fn(),
    submitRating: vi.fn(),
    submitCondition: vi.fn(),
    submitNote: vi.fn(),
    submitAttributes: vi.fn(),
    refresh: vi.fn(),
  }));
vi.mock("../../app/actions/auth", () => ({ signInWithReturn }));
vi.mock("../../app/actions/contribute", () => ({
  submitRating,
  submitCondition,
  submitNote,
  submitAttributes,
}));
vi.mock("../../lib/catalog", () => ({
  buildAttributeGroups: () => [],
  fetchAttributeTypes: vi.fn().mockResolvedValue([]),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { ContributeSection } from "./ContributeSection";

const dims = [{ rating_type_id: 1, name: "Clarity", average_rating: null, vote_count: 0 }];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("signed-out: renders sign-in form and NO rating/condition/note forms", () => {
  render(<ContributeSection fountainId="fid" dimensions={dims} isAuthenticated={false} />);
  expect(screen.getByRole("button", { name: /sign in to contribute/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /submit rating/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /i checked/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /save note/i })).not.toBeInTheDocument();
});

it("signed-in: renders simple rating first and details behind disclosure", () => {
  render(<ContributeSection fountainId="fid" dimensions={dims} isAuthenticated={true} />);
  expect(screen.getByRole("button", { name: /submit rating/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /i checked/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /save note/i })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /more details/i }));
  expect(screen.getByRole("button", { name: /i checked/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /save note/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /sign in to contribute/i })).not.toBeInTheDocument();
});
