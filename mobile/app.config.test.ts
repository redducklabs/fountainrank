import { describe, expect, it } from "vitest";

import config from "./app.config";

describe("mobile app release configuration", () => {
  it("uses 1.0.5 as the default store release version", () => {
    expect(config.version).toBe("1.0.5");
  });
});
