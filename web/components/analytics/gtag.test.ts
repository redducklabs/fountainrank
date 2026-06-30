// @vitest-environment jsdom
import { afterEach, describe, expect, it } from "vitest";
import { __resetGaConfigured, sendPageView, type PageViewParams } from "./gtag";

const params: PageViewParams = {
  page_path: "/x",
  page_location: "https://fountainrank.com/x",
  page_referrer: "",
  page_title: "X",
};

// Each dataLayer entry is the gtag() `arguments` object — array-like, read by index.
function dataLayer(): IArguments[] {
  return (window.dataLayer ?? []) as unknown as IArguments[];
}

afterEach(() => {
  __resetGaConfigured();
  delete window.dataLayer;
  delete window.gtag;
});

describe("sendPageView / ensureGaConfigured", () => {
  it("queues js -> config(send_page_view:false) -> page_view, in that order", () => {
    sendPageView("G-ABC123", params);
    const dl = dataLayer();
    expect(dl).toHaveLength(3);
    expect(dl[0][0]).toBe("js");
    expect(dl[0][1]).toBeInstanceOf(Date);
    expect(dl[1][0]).toBe("config");
    expect(dl[1][1]).toBe("G-ABC123");
    expect(dl[1][2]).toEqual({ send_page_view: false });
    expect(dl[2][0]).toBe("event");
    expect(dl[2][1]).toBe("page_view");
    expect(dl[2][2]).toEqual(params);
  });

  it("does not re-push config on the second page view", () => {
    sendPageView("G-ABC123", params);
    sendPageView("G-ABC123", { ...params, page_path: "/y" });
    const dl = dataLayer();
    expect(dl).toHaveLength(4);
    expect(Array.from(dl).filter((e) => e[0] === "config")).toHaveLength(1);
    expect(dl[3][0]).toBe("event");
    expect(dl[3][2]).toEqual({ ...params, page_path: "/y" });
  });

  it("creates window.dataLayer when it does not exist yet", () => {
    expect(window.dataLayer).toBeUndefined();
    sendPageView("G-ABC123", params);
    expect(Array.isArray(window.dataLayer)).toBe(true);
  });
});
