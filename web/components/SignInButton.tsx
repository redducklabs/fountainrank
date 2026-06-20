"use client";

import { signInAction } from "../app/actions/auth";

export function SignInButton() {
  return (
    <form action={signInAction}>
      <button
        type="submit"
        className="inline-flex items-center justify-center rounded-full bg-[#F2C200] px-6 py-2.5 text-sm font-semibold text-[#0A357E] transition hover:bg-[#ffce1f] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#F2C200]"
      >
        Sign in
      </button>
    </form>
  );
}
