import { describe, expect, it } from "vitest";

import robots from "./robots";
import sitemap from "./sitemap";

describe("sitemap", () => {
  const urls = sitemap().map((entry) => entry.url);

  it("includes the required public pages", () => {
    expect(urls).toEqual(
      expect.arrayContaining([
        "https://fountainrank.com/",
        "https://fountainrank.com/privacy",
        "https://fountainrank.com/terms",
        "https://fountainrank.com/leaderboard",
      ]),
    );
  });

  it("uses the canonical apex origin for every entry", () => {
    for (const url of urls) {
      // Compare the parsed origin exactly (not a string prefix) so a host like
      // fountainrank.com.evil.com can't satisfy the check.
      expect(new URL(url).origin).toBe("https://fountainrank.com");
    }
  });

  it("does not expose auth-gated routes", () => {
    expect(urls.some((url) => url.includes("/account") || url.includes("/admin"))).toBe(false);
  });
});

describe("robots", () => {
  const result = robots();
  const rule = Array.isArray(result.rules) ? result.rules[0] : result.rules;

  it("allows crawling and references the apex sitemap", () => {
    expect(rule?.allow).toBe("/");
    expect(result.sitemap).toBe("https://fountainrank.com/sitemap.xml");
  });

  it("disallows the auth-gated routes", () => {
    expect(rule?.disallow).toEqual(expect.arrayContaining(["/account", "/admin"]));
  });
});
