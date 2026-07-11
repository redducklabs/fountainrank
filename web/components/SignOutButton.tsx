"use client";

import { signOutAction } from "../app/actions/auth";
import { FormSubmitButton } from "./ui/FormSubmitButton";

export function SignOutButton() {
  return (
    <form action={signOutAction}>
      <FormSubmitButton className="inline-flex items-center justify-center rounded-full border border-white/40 px-6 py-2.5 text-sm font-semibold text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white">
        Sign out
      </FormSubmitButton>
    </form>
  );
}
