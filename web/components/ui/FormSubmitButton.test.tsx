// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import { FormSubmitButton } from "./FormSubmitButton";

afterEach(cleanup);

// useFormStatus reports pending=false outside an in-flight action, so this covers the idle render
// (the pending branch shares its markup with SpinnerButton, which is tested directly).
it("renders a submit button showing its children when idle", () => {
  render(
    <form>
      <FormSubmitButton>Sign in</FormSubmitButton>
    </form>,
  );
  const btn = screen.getByRole("button", { name: /sign in/i });
  expect(btn).toHaveAttribute("type", "submit");
  expect(btn).toHaveAttribute("aria-busy", "false");
  expect(btn).not.toBeDisabled();
});

it("honors an explicit disabled prop", () => {
  render(
    <form>
      <FormSubmitButton disabled>Sign in</FormSubmitButton>
    </form>,
  );
  expect(screen.getByRole("button", { name: /sign in/i })).toBeDisabled();
});
