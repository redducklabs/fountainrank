export function hrefWithoutFocus(pathname: string, search: string): string {
  const params = new URLSearchParams(search);
  params.delete("focus");
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
