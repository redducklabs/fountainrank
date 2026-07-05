// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const {
  signInWithReturn,
  submitRating,
  submitCondition,
  submitNote,
  submitAttributes,
  uploadPhoto,
  refresh,
} = vi.hoisted(() => ({
  signInWithReturn: vi.fn(),
  submitRating: vi.fn(),
  submitCondition: vi.fn(),
  submitNote: vi.fn(),
  submitAttributes: vi.fn(),
  uploadPhoto: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("../../app/actions/auth", () => ({ signInWithReturn }));
vi.mock("../../app/actions/contribute", () => ({
  submitRating,
  submitCondition,
  submitNote,
  submitAttributes,
  uploadPhoto,
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

it("signed-in primary variant renders rating and add-photo controls", () => {
  render(<ContributeSection fountainId="fid" dimensions={dims} isAuthenticated={true} />);
  expect(screen.getByRole("button", { name: /submit rating/i })).toBeInTheDocument();
  expect(screen.getByLabelText(/add a photo/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /i checked/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /save note/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /sign in to contribute/i })).not.toBeInTheDocument();
});

it("signed-in details variant renders secondary contribution controls", () => {
  render(
    <ContributeSection
      fountainId="fid"
      dimensions={dims}
      isAuthenticated={true}
      variant="details"
    />,
  );
  expect(screen.getByRole("button", { name: /i checked/i })).toBeInTheDocument();
  expect(screen.getByRole("button", { name: /save note/i })).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /submit rating/i })).not.toBeInTheDocument();
  expect(screen.queryByLabelText(/add a photo/i)).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /sign in to contribute/i })).not.toBeInTheDocument();
});

it("signed-in photos variant renders only the add-photo control", () => {
  render(
    <ContributeSection
      fountainId="fid"
      dimensions={dims}
      isAuthenticated={true}
      variant="photos"
    />,
  );
  expect(screen.getByLabelText(/add a photo/i)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /submit rating/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /i checked/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /save note/i })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: /sign in to contribute/i })).not.toBeInTheDocument();
});
