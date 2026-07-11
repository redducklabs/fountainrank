// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";

const { submitRating, refresh } = vi.hoisted(() => ({ submitRating: vi.fn(), refresh: vi.fn() }));
vi.mock("../../app/actions/contribute", () => ({ submitRating }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));

import { RatingForm } from "./RatingForm";
import { RatingDraftProvider } from "./RatingDraftContext";

type Dim = {
  rating_type_id: number;
  name: string;
  average_rating: number | null;
  vote_count: number;
  your_rating?: number | null;
};
function renderForm(dimensions: Dim[]) {
  return render(
    <RatingDraftProvider dimensions={dimensions}>
      <RatingForm fountainId="fid" dimensions={dimensions} />
    </RatingDraftProvider>,
  );
}

const dims = [
  { rating_type_id: 1, name: "Clarity", average_rating: null, vote_count: 0 },
  { rating_type_id: 2, name: "Taste", average_rating: null, vote_count: 0 },
];

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("disables submit until a star is set, then posts only set dimensions", async () => {
  submitRating.mockResolvedValue({ ok: true });
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
  let resolveSubmit!: (v: { ok: true }) => void;
  submitRating.mockReturnValue(
    new Promise<{ ok: true }>((r) => {
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
  resolveSubmit({ ok: true });
  await waitFor(() => expect(container.querySelector("svg.animate-spin")).toBeNull());
  expect(screen.getByRole("status")).toHaveTextContent(/rating was saved/i);
});

it("shows success message on ok", async () => {
  submitRating.mockResolvedValue({ ok: true });
  renderForm(dims);
  fireEvent.click(screen.getByRole("radio", { name: /clarity: 3 stars/i }));
  fireEvent.click(screen.getByRole("button", { name: /submit rating/i }));
  await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/rating was saved/i));
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
  submitRating.mockResolvedValue({ ok: true });
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
  submitRating.mockResolvedValue({ ok: true });
  renderForm(ratedDims);
  fireEvent.click(screen.getByRole("radio", { name: /clarity: 2 stars/i }));
  fireEvent.click(screen.getByRole("button", { name: /update rating/i }));
  await waitFor(() =>
    expect(submitRating).toHaveBeenCalledWith("fid", [{ rating_type_id: 1, stars: 2 }], undefined),
  );
});
