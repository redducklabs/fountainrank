import { describe, expect, it, vi } from "vitest";

import { createGuardedSubmit } from "./submit-flow";

describe("createGuardedSubmit (#212)", () => {
  it("sets busy synchronously, then clears it after the action resolves", async () => {
    const calls: boolean[] = [];
    const run = createGuardedSubmit<boolean>({
      setBusy: (v) => calls.push(v),
      idle: false,
      isMounted: () => true,
    });
    let resolve!: () => void;
    const p = run(true, () => new Promise<void>((r) => (resolve = r)));
    // Busy is set immediately — before the awaited action resolves (the "instant spinner").
    expect(calls).toEqual([true]);
    resolve();
    await p;
    expect(calls).toEqual([true, false]);
  });

  it("ignores a second call while the first is in flight", async () => {
    const action = vi.fn(() => new Promise<void>(() => {})); // never resolves
    const run = createGuardedSubmit<boolean>({
      setBusy: () => {},
      idle: false,
      isMounted: () => true,
    });
    void run(true, action);
    void run(true, action); // second tap during the flush — ignored
    expect(action).toHaveBeenCalledTimes(1);
  });

  it("allows a new call once the previous one settles", async () => {
    const action = vi.fn().mockResolvedValue(undefined);
    const run = createGuardedSubmit<boolean>({
      setBusy: () => {},
      idle: false,
      isMounted: () => true,
    });
    await run(true, action);
    await run(true, action);
    expect(action).toHaveBeenCalledTimes(2);
  });

  it("does NOT clear busy after the component unmounts", async () => {
    const calls: boolean[] = [];
    let mounted = true;
    const run = createGuardedSubmit<boolean>({
      setBusy: (v) => calls.push(v),
      idle: false,
      isMounted: () => mounted,
    });
    let resolve!: () => void;
    const p = run(true, () => new Promise<void>((r) => (resolve = r)));
    mounted = false;
    resolve();
    await p;
    expect(calls).toEqual([true]); // no trailing `false` — no setState after unmount
  });

  it("clears busy even if the action throws", async () => {
    const calls: boolean[] = [];
    const run = createGuardedSubmit<boolean>({
      setBusy: (v) => calls.push(v),
      idle: false,
      isMounted: () => true,
    });
    await expect(run(true, () => Promise.reject(new Error("boom")))).rejects.toThrow("boom");
    expect(calls).toEqual([true, false]);
    // and it is not stuck in-flight afterward
    await run(true, () => Promise.resolve());
    expect(calls).toEqual([true, false, true, false]);
  });

  it("passes through a non-boolean busy value (per-status spinner)", async () => {
    const calls: (string | null)[] = [];
    const run = createGuardedSubmit<string | null>({
      setBusy: (v) => calls.push(v),
      idle: null,
      isMounted: () => true,
    });
    await run("working", () => Promise.resolve());
    expect(calls).toEqual(["working", null]);
  });
});
