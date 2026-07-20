import { describe, expect, it } from "vitest";
import { hrefWithoutFocus, resolveFocusClearNavigation } from "./focus-url";

describe("hrefWithoutFocus", () => {
  it("removes only focus and preserves unrelated query state", () => {
    expect(hrefWithoutFocus("/", "focus=f1&campaign=spring&tag=a&tag=b")).toBe(
      "/?campaign=spring&tag=a&tag=b",
    );
  });

  it("returns the pathname when focus was the only parameter", () => {
    expect(hrefWithoutFocus("/", "focus=f1")).toBe("/");
  });
});

describe("resolveFocusClearNavigation", () => {
  it("cleans the current history entry before opening another fountain", () => {
    expect(
      resolveFocusClearNavigation({
        ownedFocus: "focused-fountain",
        trigger: "open-detail",
        pathname: "/",
        search: "focus=focused-fountain&campaign=spring",
      }),
    ).toEqual({ kind: "replace-state", href: "/?campaign=spring" });
  });

  it("replaces the route when the focused callout is dismissed", () => {
    expect(
      resolveFocusClearNavigation({
        ownedFocus: "focused-fountain",
        trigger: "dismiss",
        pathname: "/",
        search: "focus=focused-fountain",
      }),
    ).toEqual({ kind: "router-replace", href: "/" });
  });

  it("does nothing when list-originated focus no longer owns selection", () => {
    expect(
      resolveFocusClearNavigation({
        ownedFocus: "",
        trigger: "dismiss",
        pathname: "/fountains/route-selection",
        search: "campaign=spring",
      }),
    ).toEqual({ kind: "noop" });
  });
});
