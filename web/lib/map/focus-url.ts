export function hrefWithoutFocus(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("focus");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}

export type FocusClearNavigation =
  { kind: "noop" } | { kind: "replace-state" | "router-replace"; href: string };

export function resolveFocusClearNavigation({
  ownedFocus,
  trigger,
  pathname,
  search,
}: {
  ownedFocus: string;
  trigger: "open-detail" | "dismiss";
  pathname: string;
  search: string;
}): FocusClearNavigation {
  if (!ownedFocus) return { kind: "noop" };
  return {
    kind: trigger === "open-detail" ? "replace-state" : "router-replace",
    href: hrefWithoutFocus(pathname, search),
  };
}
