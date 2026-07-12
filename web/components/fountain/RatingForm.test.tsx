// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { submitRating, refresh } = vi.hoisted(() => ({ submitRating: vi.fn(), refresh: vi.fn() }));
vi.mock("../../app/actions/contribute", () => ({ submitRating }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import type { ViewerAwardStateT } from "@fountainrank/contributions";

import { RatingForm } from "./RatingForm";
import { RatingDraftProvider } from "./RatingDraftContext";

type Dim = {
  rating_type_id: number;
  name: string;
  average_rating: number | null;
  vote_count: number;
  your_rating?: number | null;
};
function renderForm(dimensions: Dim[], viewerAwardState?: ViewerAwardStateT | null) {
  return render(
    <RatingDraftProvider dimensions={dimensions}>
      <RatingForm fountainId="fid" dimensions={dimensions} viewerAwardState={viewerAwardState} />
    </RatingDraftProvider>,
  );
}

/** The viewer has already been awarded for every dimension — nothing left to earn here. */
const ALL_SPENT: ViewerAwardStateT = {
  unrated_rating_type_ids: [],
  unobserved_attribute_type_ids: [],
  note_earnable: false,
  photo_first_earnable: false,
};

const dims = [
  { rating_type_id: 1, name: "Clarity", average_rating: null, vote_count: 0 },
  { rating_type_id: 2, name: "Taste", average_rating: null, vote_count: 0 },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("disables submit until a star is set, then posts only set dimensions", async () => {
  submitRating.mockResolvedValue({ ok: true, pointsAwarded: 4 });
  renderForm(dims);
  const submit = screen.getByRole("button", { name: /submit rating/i });
  expect(submit).toBeDisabled();
  fireEvent.click(screen.getByRole("radio", { name: /clarity: 4 stars/i }));
  expect(submit).not.toBeDisabled();
  fireEvent.click(submit);
  await waitFor(() =>
    expect(submitRating).toHaveBeenCalledWith("fid", [{ rating_type_id: 1, stars: 4 }], undefined),
  );
  await waitFor(() => expect(refresh).toHaveBeenCalled());
});

it("shows a spinner and disables submit immediately on click, before the action resolves", async () => {
  let resolveSubmit!: (v: { ok: true; pointsAwarded: number }) => void;
  submitRating.mockReturnValue(
    new Promise<{ ok: true; pointsAwarded: number }>((r) => {
      resolveSubmit = r;
    }),
  );
  const { container } = renderForm(dims);
  fireEvent.click(screen.getByRole("radio", { name: /clarity: 4 stars/i }));
  const submit = screen.getByRole("button", { name: /submit rating/i });
  fireEvent.click(submit);
  // Immediate feedback: the button is busy + disabled and the spinner is present BEFORE the
  // (still-unresolved) server action returns.
  await waitFor(() => expect(submit).toHaveAttribute("aria-busy", "true"));
  expect(submit).toBeDisabled();
  expect(container.querySelector("svg.animate-spin")).toBeInTheDocument();
  // Resolve → spinner clears and hands off to the success message.
  resolveSubmit({ ok: true, pointsAwarded: 4 });
  await waitFor(() => expect(container.querySelector("svg.animate-spin")).toBeNull());
  expect(screen.getByRole("status")).toHaveTextContent(/you earned 4 points/i);
});

it("shows success message on ok", async () => {
  submitRating.mockResolvedValue({ ok: true, pointsAwarded: 4 });
  renderForm(dims);
  fireEvent.click(screen.getByRole("radio", { name: /clarity: 3 stars/i }));
  fireEvent.click(screen.getByRole("button", { name: /submit rating/i }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/you earned 4 points/i));
});

it("shows error message on failure", async () => {
  submitRating.mockResolvedValue({ ok: false, error: "server" });
  renderForm(dims);
  fireEvent.click(screen.getByRole("radio", { name: /clarity: 1 star/i }));
  fireEvent.click(screen.getByRole("button", { name: /submit rating/i }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/couldn't save/i));
});

const ratedDims = [
  { rating_type_id: 1, name: "Clarity", average_rating: 4, vote_count: 3, your_rating: 4 },
  { rating_type_id: 2, name: "Taste", average_rating: null, vote_count: 0, your_rating: null },
];

it("pre-fills from your_rating, shows the update affordance, and submits the saved value", async () => {
  submitRating.mockResolvedValue({ ok: true, pointsAwarded: 4 });
  renderForm(ratedDims);
  expect(screen.getByRole("radio", { name: /clarity: 4 stars/i })).toBeChecked();
  expect(screen.getByText(/you.ve rated this fountain/i)).toBeInTheDocument();
  const submit = screen.getByRole("button", { name: /update rating/i });
  expect(submit).not.toBeDisabled();
  fireEvent.click(submit);
  await waitFor(() =>
    expect(submitRating).toHaveBeenCalledWith("fid", [{ rating_type_id: 1, stars: 4 }], undefined),
  );
});

it("lets an explicit edit override the pre-filled rating", async () => {
  submitRating.mockResolvedValue({ ok: true, pointsAwarded: 4 });
  renderForm(ratedDims);
  fireEvent.click(screen.getByRole("radio", { name: /clarity: 2 stars/i }));
  fireEvent.click(screen.getByRole("button", { name: /update rating/i }));
  await waitFor(() =>
    expect(submitRating).toHaveBeenCalledWith("fid", [{ rating_type_id: 1, stars: 2 }], undefined),
  );
});

it("warns pre-submit instead of promising points when every dimension is already earned (#204)", () => {
  renderForm(dims, ALL_SPENT);
  fireEvent.click(screen.getAllByRole("radio")[4]);

  // The old code promised "+2 possible points" here and then awarded 0.
  expect(screen.getByText(/won.t earn points again/i)).toBeInTheDocument();
  expect(screen.queryByText(/possible points/i)).not.toBeInTheDocument();
});

it("says a 0-point re-rate earned nothing, and does NOT celebrate (#204)", async () => {
  submitRating.mockResolvedValue({ ok: true, pointsAwarded: 0 });
  const celebrations: number[] = [];
  window.addEventListener("fountainrank:contribution", (e) => {
    celebrations.push((e as CustomEvent<{ points: number }>).detail.points);
  });

  renderForm(dims, ALL_SPENT);
  fireEvent.click(screen.getAllByRole("radio")[4]);
  fireEvent.click(screen.getByRole("button", { name: /rating/i }));

  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/no points this time/i));
  // The event still fires (the header refreshes its stats), but it carries a verified 0 — which is
  // what the listeners gate on, so no celebration renders.
  expect(celebrations).toEqual([0]);
});
