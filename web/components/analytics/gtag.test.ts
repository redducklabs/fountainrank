// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { __resetGaConfigured, sendPageView, type PageViewParams } from "./gtag";

const params: PageViewParams = {
  page_path: "/x",
  page_location: "https://fountainrank.com/x",
  page_referrer: "",
  page_title: "X",
};

afterEach(() => {
  __resetGaConfigured();
  delete window.dataLayer;
  delete window.gtag;
});

describe("sendPageView / ensureGaConfigured", () => {
  it("queues js -> config(send_page_view:false) -> page_view, in that order", () => {
    sendPageView("G-ABC123", params);
    const dl = window.dataLayer!;
    expect(dl).toHaveLength(3);
    expect(dl[0]).toEqual(["js", expect.any(Date)]);
    expect(dl[1]).toEqual(["config", "G-ABC123", { send_page_view: false }]);
    expect(dl[2]).toEqual(["event", "page_view", params]);
  });

  it("does not re-push config on the second page view", () => {
    sendPageView("G-ABC123", params);
    sendPageView("G-ABC123", { ...params, page_path: "/y" });
    const dl = window.dataLayer!;
    expect(dl).toHaveLength(4);
    expect(dl.filter((e) => Array.isArray(e) && e[0] === "config")).toHaveLength(1);
    expect(dl[3]).toEqual(["event", "page_view", { ...params, page_path: "/y" }]);
  });

  it("creates window.dataLayer when it does not exist yet", () => {
    expect(window.dataLayer).toBeUndefined();
    sendPageView("G-ABC123", params);
    expect(Array.isArray(window.dataLayer)).toBe(true);
  });
});
