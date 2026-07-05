"use client";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { uploadPhoto } from "../../app/actions/contribute";
import { errorText } from "./contributeError";

const ACCEPTED_TYPES = "image/jpeg,image/png,image/webp";

export function PhotoUpload({ fountainId }: { fountainId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ tone: "ok" | "err"; text: string } | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setMsg(null);
    const formData = new FormData();
    formData.set("file", file);
    start(async () => {
      const res = await uploadPhoto(fountainId, formData);
      if (res.ok) {
        setMsg({ tone: "ok", text: "Photo uploaded — thanks!" });
        window.dispatchEvent(new Event("fountainrank:contribution"));
        router.refresh();
      } else {
        setMsg({ tone: "err", text: errorText(res.error) });
      }
      // Always reset the input so re-selecting the same file re-fires onChange.
      if (inputRef.current) inputRef.current.value = "";
    });
  }

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-700">Add a photo</h3>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_TYPES}
        aria-label="Add a photo"
        disabled={pending}
        onChange={handleChange}
        className="mt-1 block w-full text-sm text-slate-600 file:mr-3 file:rounded-full file:border-0 file:bg-[#0A357E] file:px-4 file:py-1.5 file:text-sm file:font-semibold file:text-white file:disabled:opacity-50 disabled:opacity-50"
      />
      <p className="mt-1 text-xs text-slate-400">JPEG, PNG, or WebP, up to 10 MB.</p>
      {pending && (
        <p role="status" aria-live="polite" className="mt-1 text-xs text-slate-500">
          Uploading…
        </p>
      )}
      {!pending && msg && (
        <p
          role="status"
          aria-live="polite"
          className={msg.tone === "ok" ? "text-emerald-700" : "text-red-700"}
        >
          {msg.text}
        </p>
      )}
    </div>
  );
}
