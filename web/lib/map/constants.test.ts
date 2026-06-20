import { describe, expect, it } from "vitest";
import { MAX_BBOX_RESULTS } from "./constants";
// Pinned contract: backend settings.max_results (backend/app/config.py). The backend test
// test_max_results_pinned asserts the backend value; keep these in sync (deploy-env overrides
// must set the same value for web).
describe("MAX_BBOX_RESULTS", () => {
  it("is the pinned backend default", () => expect(MAX_BBOX_RESULTS).toBe(500));
});
