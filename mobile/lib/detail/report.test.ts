import { describe, expect, it } from "vitest";

import { createApiClient } from "../api";
import { REPORT_CATEGORIES, reportContent, type ReportContentType } from "./report";

type CapturedRequest = { url: string; method: string; body: unknown };

/**
 * Build a real mobile API client whose fetch is mocked to capture the outgoing
 * request (URL, method, JSON body) and return a 204. Using the real client (not a
 * hand-rolled stub) exercises the actual openapi-fetch path templating + body
 * serialization that `reportContent` relies on, mirroring `lib/api.test.ts`.
 */
function capturingClient(captured: CapturedRequest[]) {
  const fetchMock: typeof fetch = async (input, init) => {
    const req = input instanceof Request ? input : new Request(String(input), init);
    const text = await req.text();
    captured.push({
      url: req.url,
      method: req.method,
      body: text ? (JSON.parse(text) as unknown) : undefined,
    });
    return new Response(null, { status: 204 });
  };
  return createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
}

const FOUNTAIN_ID = "11111111-1111-1111-1111-111111111111";
const CONTENT_ID = "22222222-2222-2222-2222-222222222222";

describe("reportContent", () => {
  it("POSTs the nested photo report endpoint with fountain_id + photo_id", async () => {
    const captured: CapturedRequest[] = [];
    const client = capturingClient(captured);
    await reportContent(client, {
      contentType: "photo",
      fountainId: FOUNTAIN_ID,
      contentId: CONTENT_ID,
      category: "inappropriate",
      note: "bad",
    });
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe(
      `https://api.fountainrank.com/api/v1/fountains/${FOUNTAIN_ID}/photos/${CONTENT_ID}/report`,
    );
    expect(captured[0].body).toEqual({ category: "inappropriate", note: "bad" });
  });

  it("POSTs the nested note report endpoint with fountain_id + note_id", async () => {
    const captured: CapturedRequest[] = [];
    const client = capturingClient(captured);
    await reportContent(client, {
      contentType: "note",
      fountainId: FOUNTAIN_ID,
      contentId: CONTENT_ID,
      category: "abuse",
      note: undefined,
    });
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe(
      `https://api.fountainrank.com/api/v1/fountains/${FOUNTAIN_ID}/notes/${CONTENT_ID}/report`,
    );
    // An omitted note must not be serialized (JSON drops undefined) — the backend
    // treats absent and null identically, matching the original photo report body.
    expect(captured[0].body).toEqual({ category: "abuse" });
  });

  it("POSTs the fountain report endpoint (content_id == fountain_id, single path param)", async () => {
    const captured: CapturedRequest[] = [];
    const client = capturingClient(captured);
    await reportContent(client, {
      contentType: "fountain",
      fountainId: FOUNTAIN_ID,
      contentId: FOUNTAIN_ID,
      category: "not_a_fountain",
      note: "not real",
    });
    expect(captured[0].method).toBe("POST");
    expect(captured[0].url).toBe(
      `https://api.fountainrank.com/api/v1/fountains/${FOUNTAIN_ID}/report`,
    );
    expect(captured[0].body).toEqual({ category: "not_a_fountain", note: "not real" });
  });

  it("throws ApiError (via unwrap) on an HTTP error status", async () => {
    const fetchMock: typeof fetch = async () => new Response("boom", { status: 429 });
    const client = createApiClient("https://api.fountainrank.com", { fetch: fetchMock });
    await expect(
      reportContent(client, {
        contentType: "note",
        fountainId: FOUNTAIN_ID,
        contentId: CONTENT_ID,
        category: "spam",
        note: undefined,
      }),
    ).rejects.toMatchObject({ status: 429 });
  });
});

describe("REPORT_CATEGORIES", () => {
  it("offers exactly the photo category subset (unchanged from the photo slice)", () => {
    expect(REPORT_CATEGORIES.photo.map((c) => c.value)).toEqual([
      "inappropriate",
      "not_a_fountain",
      "spam",
      "other",
    ]);
  });

  it("offers the note category subset (spec §6)", () => {
    expect(REPORT_CATEGORIES.note.map((c) => c.value)).toEqual([
      "spam",
      "abuse",
      "inappropriate",
      "inaccurate",
      "other",
    ]);
  });

  it("offers the fountain category subset (spec §6)", () => {
    expect(REPORT_CATEGORIES.fountain.map((c) => c.value)).toEqual([
      "not_a_fountain",
      "spam",
      "inappropriate",
      "inaccurate",
      "other",
    ]);
  });

  it("covers every content type with a non-empty, labeled option list", () => {
    const types: ReportContentType[] = ["photo", "note", "fountain"];
    for (const type of types) {
      expect(REPORT_CATEGORIES[type].length).toBeGreaterThan(0);
      for (const option of REPORT_CATEGORIES[type]) {
        expect(option.value).toMatch(/^[a-z_]+$/);
        expect(option.label.length).toBeGreaterThan(0);
      }
    }
  });
});
