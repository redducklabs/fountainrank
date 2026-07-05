"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
export function DetailOverlay({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  const closingRef = useRef(false);
  const [open, setOpen] = useState(false);
  const requestClose = useCallback(() => {
    if (closingRef.current) return;
    closingRef.current = true;
    setOpen(false);
    window.setTimeout(() => router.back(), 200);
  }, [router]);

  useEffect(() => {
    const panel = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;
    const frame = window.requestAnimationFrame(() => setOpen(true));
    panel?.focus();
    const focusables = () =>
      panel
        ? Array.from(
            panel.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),input,select,textarea,[tabindex]:not([tabindex="-1"])',
            ),
          )
        : [];
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        requestClose();
        return;
      }
      if (e.key !== "Tab") return; // trap Tab within the dialog
      const els = focusables();
      if (els.length === 0) {
        e.preventDefault();
        panel?.focus();
        return;
      }
      const first = els[0],
        last = els[els.length - 1],
        active = document.activeElement;
      if (e.shiftKey && (active === first || active === panel)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && active === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    }; // restore focus
  }, [requestClose]);
  return (
    <div className="fixed inset-0 z-50">
      <div
        className={`absolute inset-0 bg-black/30 transition-opacity duration-200 ${
          open ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
        onClick={requestClose}
        aria-hidden
      />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-label="Fountain detail"
        className={`absolute inset-y-0 right-0 flex h-dvh w-full max-w-full flex-col bg-white shadow-xl transition-transform duration-200 ease-out md:w-[28rem] ${
          open
            ? "translate-y-0 md:translate-x-0"
            : "translate-y-full md:translate-x-full md:translate-y-0"
        }`}
      >
        <button
          onClick={requestClose}
          aria-label="Close"
          className="absolute right-4 top-3 z-10 h-8 w-8 rounded-full bg-slate-100 text-slate-600 hover:bg-slate-200 focus-visible:ring-2 focus-visible:ring-[#0A357E]"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
