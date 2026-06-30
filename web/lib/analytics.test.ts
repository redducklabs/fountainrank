import { describe, expect, it } from "vitest";
import {
  GA_MEASUREMENT_ID_DEFAULT,
  isCanonicalHost,
  isValidGaMeasurementId,
  parseConsent,
  resolveGaMeasurementId,
  sanitizePagePath,
  sanitizeUrl,
  shouldLoadGa,
  shouldShowBanner,
  type Consent,
} from "./analytics";

describe("parseConsent", () => {
  it("maps the stored literals and defaults everything else to undecided", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
    expect(parseConsent(null)).toBe("undecided");
    expect(parseConsent(undefined)).toBe("undecided");
    expect(parseConsent("")).toBe("undecided");
    expect(parseConsent("yes")).toBe("undecided");
  });
});

describe("isCanonicalHost", () => {
  it("accepts only the canonical hosts", () => {
    expect(isCanonicalHost("fountainrank.com")).toBe(true);
    expect(isCanonicalHost("www.fountainrank.com")).toBe(true);
    expect(isCanonicalHost("localhost")).toBe(false);
    expect(isCanonicalHost("evil.com")).toBe(false);
    expect(isCanonicalHost("staging.fountainrank.com")).toBe(false);
    expect(isCanonicalHost(undefined)).toBe(false);
    expect(isCanonicalHost("")).toBe(false);
  });
});

describe("resolveGaMeasurementId", () => {
  it("returns the default when no override is set", () => {
    expect(resolveGaMeasurementId({})).toBe(GA_MEASUREMENT_ID_DEFAULT);
    expect(resolveGaMeasurementId({ NEXT_PUBLIC_GA_MEASUREMENT_ID: undefined })).toBe(
      GA_MEASUREMENT_ID_DEFAULT,
    );
  });
  it("honors the NEXT_PUBLIC_GA_MEASUREMENT_ID override (tests only)", () => {
    expect(resolveGaMeasurementId({ NEXT_PUBLIC_GA_MEASUREMENT_ID: "G-OTHER1" })).toBe("G-OTHER1");
  });
});

describe("isValidGaMeasurementId", () => {
  it("accepts well-formed GA4 ids", () => {
    expect(isValidGaMeasurementId("G-BG3PYM6T43")).toBe(true);
    expect(isValidGaMeasurementId("G-ABC123")).toBe(true);
  });
  it("rejects malformed / hostile ids", () => {
    expect(isValidGaMeasurementId("")).toBe(false);
    expect(isValidGaMeasurementId("UA-123")).toBe(false);
    expect(isValidGaMeasurementId("G-abc")).toBe(false); // lowercase
    expect(isValidGaMeasurementId("G-1');alert(1)//")).toBe(false);
    expect(isValidGaMeasurementId("<script>")).toBe(false);
    expect(isValidGaMeasurementId("G-")).toBe(false);
  });
});

describe("sanitizePagePath", () => {
  it("returns the path unchanged when already clean", () => {
    expect(sanitizePagePath("/x")).toBe("/x");
    expect(sanitizePagePath("/leaderboard")).toBe("/leaderboard");
  });
  it("strips query strings and fragments", () => {
    expect(sanitizePagePath("/x?a=1")).toBe("/x");
    expect(sanitizePagePath("/x#h")).toBe("/x");
    expect(sanitizePagePath("/leaderboard?lat=1&lng=2")).toBe("/leaderboard");
    expect(sanitizePagePath("/x#h?a")).toBe("/x");
  });
  it("defends against a full URL accidentally passed in", () => {
    expect(sanitizePagePath("https://fountainrank.com/leaderboard?lat=1#x")).toBe("/leaderboard");
  });
  it("falls back to / for empty input", () => {
    expect(sanitizePagePath("")).toBe("/");
  });
});

describe("sanitizeUrl", () => {
  it("returns origin + pathname only", () => {
    expect(sanitizeUrl("https://fountainrank.com/x?a=1#h")).toBe("https://fountainrank.com/x");
    expect(sanitizeUrl("https://fountainrank.com/")).toBe("https://fountainrank.com/");
  });
  it("returns empty string for empty / unparseable input", () => {
    expect(sanitizeUrl("")).toBe("");
    expect(sanitizeUrl(null)).toBe("");
    expect(sanitizeUrl(undefined)).toBe("");
    expect(sanitizeUrl("not a url")).toBe("");
  });
});

// The §5.E matrix: GA loads / banner shows only on production + canonical host.
const consents: Consent[] = ["granted", "denied", "undecided"];
const hosts = ["fountainrank.com", "localhost"];
const envs = ["production", "development"];

describe("shouldLoadGa", () => {
  it("is true only for granted + production + canonical host", () => {
    for (const consent of consents) {
      for (const host of hosts) {
        for (const env of envs) {
          const expected =
            consent === "granted" && env === "production" && host === "fountainrank.com";
          expect(shouldLoadGa(consent, env, host)).toBe(expected);
        }
      }
    }
  });
});

describe("shouldShowBanner", () => {
  it("is true only for undecided + production + canonical host", () => {
    for (const consent of consents) {
      for (const host of hosts) {
        for (const env of envs) {
          const expected =
            consent === "undecided" && env === "production" && host === "fountainrank.com";
          expect(shouldShowBanner(consent, env, host)).toBe(expected);
        }
      }
    }
  });
});
