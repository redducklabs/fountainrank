"use client";

import { signInAction } from "../app/actions/auth";
import { FormSubmitButton } from "./ui/FormSubmitButton";

export function SignInButton() {
  return (
    <form action={signInAction}>
      <FormSubmitButton className="inline-flex items-center justify-center rounded-full bg-accent-gold px-6 py-2.5 text-sm font-semibold text-brand transition hover:bg-accent-gold-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent-gold">
        Sign in
      </FormSubmitButton>
    </form>
  );
}
