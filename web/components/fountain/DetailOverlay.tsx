"use client";
import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
export function DetailOverlay({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const panel = ref.current;
    const prevFocus = document.activeElement as HTMLElement | null;
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
        router.back();
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
      document.removeEventListener("keydown", onKey);
      prevFocus?.focus?.();
    }; // restore focus
  }, [router]);
  return (
    <div className="fixed inset-0 z-50">
      <div className="absolute inset-0 bg-black/30" onClick={() => router.back()} aria-hidden />
      <div
        ref={ref}
        tabIndex={-1}
        role="dialog"
        aria-label="Fountain detail"
        className="absolute inset-x-0 bottom-0 max-h-[85vh] overflow-auto rounded-t-2xl bg-white p-5 shadow-xl md:inset-y-0 md:left-auto md:right-0 md:w-96 md:rounded-none"
      >
        <button
          onClick={() => router.back()}
          aria-label="Close"
          className="absolute right-4 top-4 h-7 w-7 rounded-full bg-slate-100 text-slate-600"
        >
          ×
        </button>
        {children}
      </div>
    </div>
  );
}
