"use client";
export function ShareButton() {
  const onClick = async () => {
    try {
      if (navigator.share) await navigator.share({ url: window.location.href });
      else await navigator.clipboard.writeText(window.location.href);
    } catch {
      /* user cancelled the share sheet — no-op */
    }
  };
  return (
    <button
      onClick={onClick}
      className="rounded-full border border-[#cdd6e6] bg-white px-4 py-2 text-sm font-bold text-[#0A357E]"
    >
      Share
    </button>
  );
}
