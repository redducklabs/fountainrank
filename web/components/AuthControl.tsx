"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { signInWithReturn, signOutAction } from "../app/actions/auth";
import type { Viewer } from "../lib/server/viewer";

export function AuthControl({ viewer }: { viewer: Viewer }) {
  const pathname = usePathname();
  const search = useSearchParams();
  const returnTo = pathname + (search?.toString() ? `?${search.toString()}` : "");

  if (viewer.state === "anonymous") {
    return (
      <form action={signInWithReturn.bind(null, returnTo)}>
        <button
          type="submit"
          className="inline-flex shrink-0 items-center justify-center rounded-full bg-[#F2C200] px-5 py-2 text-sm font-semibold text-[#0A357E] transition hover:bg-[#ffce1f]"
        >
          Sign in
        </button>
      </form>
    );
  }

  const isAdmin = viewer.state === "authed" && viewer.isAdmin;
  const name = viewer.state === "authed" ? viewer.displayName : "";
  const avatarUrl = viewer.state === "authed" ? viewer.avatarUrl : null;
  return (
    <UserMenu
      name={name}
      avatarUrl={avatarUrl}
      isAdmin={isAdmin}
      degraded={viewer.state === "error"}
    />
  );
}

function UserMenu({
  name,
  avatarUrl,
  isAdmin,
  degraded,
}: {
  name: string;
  avatarUrl: string | null;
  isAdmin: boolean;
  degraded: boolean;
}) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onClick = (e: MouseEvent) => {
      if (
        !menuRef.current?.contains(e.target as Node) &&
        !buttonRef.current?.contains(e.target as Node)
      ) {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    menuRef.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, [open]);

  const initial = (name || "?").trim().charAt(0).toUpperCase() || "?";
  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open account menu"
        onClick={() => setOpen((v) => !v)}
        className="flex h-9 w-9 items-center justify-center overflow-hidden rounded-full bg-white/20 text-sm font-semibold text-white"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- arbitrary external avatar host
          <img src={avatarUrl} alt="" width={36} height={36} className="h-9 w-9 object-cover" />
        ) : (
          <span aria-hidden="true">{initial}</span>
        )}
      </button>
      {open && (
        <div
          ref={menuRef}
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 text-left shadow-lg"
        >
          {name && <p className="px-3 py-2 text-sm font-semibold text-slate-700">{name}</p>}
          {degraded && (
            <p className="px-3 py-1 text-xs text-amber-700">Couldn&rsquo;t load your account.</p>
          )}
          <Link
            role="menuitem"
            href="/account"
            className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          >
            Your account
          </Link>
          {isAdmin && (
            <Link
              role="menuitem"
              href="/admin"
              className="block px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
            >
              Admin
            </Link>
          )}
          <div className="my-1 border-t border-slate-100" />
          <form action={signOutAction}>
            <button
              role="menuitem"
              type="submit"
              className="block w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
