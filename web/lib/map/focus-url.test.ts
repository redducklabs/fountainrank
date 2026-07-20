import { describe, expect, it } from "vitest";
import { hrefWithoutFocus } from "./focus-url";

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
