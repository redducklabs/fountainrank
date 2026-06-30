"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";

import { setDisplayName, type SetNameError } from "../../app/actions/profile";
import { DISPLAY_NAME_MAX } from "../../lib/display-name";

const ERROR_TEXT: Record<SetNameError, string> = {
  unauthenticated: "Your session expired — please sign in again.",
  validation: "Please enter 1–80 characters.",
  server: "Couldn’t save — please try again.",
};

// The single "Display name" field. `required` renders the first-sign-in capture variant (heading,
// no dismiss); otherwise it is the change-name field on the account screen. Saves via the
// setDisplayName server action (-> PATCH /me) and refreshes so needs_name re-resolves.
export function DisplayNameForm({
  initialValue,
  required,
}: {
  initialValue: string;
  required: boolean;
}) {
  const router = useRouter();
  const [value, setValue] = useState(initialValue);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function submit() {
    setMsg(null);
    start(async () => {
      const res = await setDisplayName(value);
      if (res.ok) {
        setMsg({ tone: "ok", text: "Saved." });
        router.refresh();
      } else {
        setMsg({ tone: "err", text: ERROR_TEXT[res.error] });
      }
    });
  }

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex w-full max-w-sm flex-col gap-3 text-left"
    >
      {required && (
        <div>
          <h2 className="text-lg font-bold">Choose a display name</h2>
          <p className="text-sm text-white/80">
            Pick a name to show on the leaderboard and your notes. You can change it later.
          </p>
        </div>
      )}
      <label className="flex flex-col gap-1 text-sm font-semibold">
        Display name
        <input
          type="text"
          value={value}
          maxLength={DISPLAY_NAME_MAX}
          onChange={(e) => setValue(e.target.value)}
          autoComplete="nickname"
          placeholder="Your name"
          className="rounded-md border border-white/30 bg-white/10 px-3 py-2 text-base font-normal text-white placeholder:text-white/50"
        />
      </label>
      <button
        type="submit"
        disabled={pending || value.trim().length === 0}
        className="rounded-full bg-[#F2C200] px-5 py-2 text-sm font-bold text-[#0A357E] disabled:opacity-50"
      >
        {pending ? "Saving…" : required ? "Continue" : "Save"}
      </button>
      {msg && (
        <p
          role="status"
          aria-live="polite"
          className={msg.tone === "ok" ? "text-emerald-200" : "text-red-200"}
        >
          {msg.text}
        </p>
      )}
    </form>
  );
}
