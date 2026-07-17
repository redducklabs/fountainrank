import { describe, expect, it, vi } from "vitest";

import {
  createWatchController,
  WATCH_RETRY_DELAY_MS,
  type StartWatch,
  type TimerId,
  type WatchDiagnosticEvent,
  type WatchHandle,
  type WatchTimer,
} from "./location-watch";
import type { RawPosition } from "./location";

const FIX: RawPosition = { coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: 1_000 };

/** Flush pending microtasks (start-promise `.then` handlers). Real timer - unrelated to the injected
 *  WatchTimer, which is a manual fake. */
function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type StartRecord = {
  onFix: (pos: RawPosition) => void;
  removed: number;
  resolve: () => void;
  reject: () => void;
};

/** A `startWatch` that records each call, exposing per-start resolve/reject and a remove counter. */
function makeStartHarness() {
  const starts: StartRecord[] = [];
  const startWatch: StartWatch = (onFix) => {
    let resolveP!: (h: WatchHandle) => void;
    let rejectP!: (e: unknown) => void;
    const promise = new Promise<WatchHandle>((res, rej) => {
      resolveP = res;
      rejectP = rej;
    });
    const rec: StartRecord = {
      onFix,
      removed: 0,
      resolve: () => resolveP({ remove: () => (rec.removed += 1) }),
      reject: () => rejectP(new Error("start failed")),
    };
    starts.push(rec);
    return promise;
  };
  return { startWatch, starts };
}

/** A manual timer so the retry cadence is deterministic and countable. */
function makeFakeTimer() {
  let nextId = 1;
  const jobs = new Map<number, () => void>();
  const timer: WatchTimer = {
    set: (fn) => {
      const id = nextId++;
      jobs.set(id, fn);
      return id as unknown as TimerId;
    },
    clear: (id) => {
      jobs.delete(id as unknown as number);
    },
  };
  return {
    timer,
    count: () => jobs.size,
    fireAll: () => {
      const current = [...jobs.values()];
      jobs.clear();
      for (const fn of current) fn();
    },
  };
}

function makeController() {
  const { startWatch, starts } = makeStartHarness();
  const { timer, count, fireAll } = makeFakeTimer();
  const onFix = vi.fn();
  const sink = vi.fn<(event: WatchDiagnosticEvent) => void>();
  const controller = createWatchController({ startWatch, onFix, sink, timer });
  const types = () => sink.mock.calls.map(([e]) => e.type);
  return { controller, starts, onFix, sink, types, retryCount: count, fireRetry: fireAll };
}

describe("createWatchController — serialized starts (spec §1)", () => {
  it("installs exactly one subscription when desired, forwards only its fixes, and emits watch_started", async () => {
    const { controller, starts, onFix, types } = makeController();
    controller.setDesired(true);
    expect(starts).toHaveLength(1);
    starts[0].resolve();
    await flush();
    expect(types()).toEqual(["watch_started"]);

    starts[0].onFix(FIX);
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(onFix).toHaveBeenCalledWith(FIX);
  });

  it("does not start a second concurrent watch while one start is pending", async () => {
    const { controller, starts } = makeController();
    controller.setDesired(true);
    controller.setDesired(true); // redundant desired edge - no second native start
    expect(starts).toHaveLength(1);
  });

  it("desired true→false→true while pending: settled subscription removed + exactly one replacement", async () => {
    const { controller, starts, types } = makeController();
    controller.setDesired(true);
    controller.setDesired(false);
    controller.setDesired(true); // flap while start #0 is still pending
    expect(starts).toHaveLength(1); // still no second concurrent start

    starts[0].resolve();
    await flush();
    // The settled (stale) subscription is removed and exactly one replacement is issued.
    expect(starts[0].removed).toBe(1);
    expect(starts).toHaveLength(2);
    expect(types()).toEqual([]); // no watch_started for the discarded one

    starts[1].resolve();
    await flush();
    expect(types()).toEqual(["watch_started"]);
    expect(starts[1].removed).toBe(0); // replacement stays live
  });

  it("a start resolving after stop is removed immediately and publishes zero fixes", async () => {
    const { controller, starts, onFix, types } = makeController();
    controller.setDesired(true);
    controller.stop(); // blur/background before the start settles
    starts[0].resolve();
    await flush();
    expect(starts[0].removed).toBe(1);
    expect(types()).toEqual([]); // never installed → no watch_started, no watch_stopped

    starts[0].onFix(FIX); // a late native fix on the discarded subscription
    expect(onFix).not.toHaveBeenCalled();
  });

  it("a start resolving after dispose is removed immediately, silently, with zero fixes", async () => {
    const { controller, starts, onFix, types } = makeController();
    controller.setDesired(true);
    controller.dispose();
    starts[0].resolve();
    await flush();
    expect(starts[0].removed).toBe(1);
    expect(types()).toEqual([]);
    starts[0].onFix(FIX);
    expect(onFix).not.toHaveBeenCalled();
  });

  it("only the installed subscription publishes: a stale-generation fix is dropped and does not count", async () => {
    const { controller, starts, onFix, sink } = makeController();
    controller.setDesired(true);
    controller.setDesired(false);
    controller.setDesired(true);
    starts[0].resolve(); // start #0 is stale (flap) → removed, replaced by #1
    await flush();
    starts[1].resolve();
    await flush();

    starts[0].onFix(FIX); // fix from the removed, stale subscription
    expect(onFix).not.toHaveBeenCalled();
    expect(sink.mock.calls.filter(([e]) => e.type === "watch_fix_received")).toHaveLength(0);

    starts[1].onFix(FIX); // fix from the live subscription
    expect(onFix).toHaveBeenCalledTimes(1);
    expect(sink.mock.calls.filter(([e]) => e.type === "watch_fix_received")).toHaveLength(1);
  });
});

describe("createWatchController — stop vs dispose", () => {
  it("stop removes the live subscription and emits watch_stopped; a second stop is a no-op", async () => {
    const { controller, starts, types } = makeController();
    controller.setDesired(true);
    starts[0].resolve();
    await flush();

    controller.stop();
    expect(starts[0].removed).toBe(1);
    expect(types()).toEqual(["watch_started", "watch_stopped"]);

    controller.stop(); // idempotent
    expect(starts[0].removed).toBe(1);
    expect(types()).toEqual(["watch_started", "watch_stopped"]);
  });

  it("refocus after a stop restarts the watch (survives the transition, not disposed)", async () => {
    const { controller, starts } = makeController();
    controller.setDesired(true);
    starts[0].resolve();
    await flush();
    controller.stop();

    controller.setDesired(true); // refocus
    expect(starts).toHaveLength(2);
    starts[1].resolve();
    await flush();
    starts[1].onFix(FIX);
  });

  it("dispose removes the live subscription silently (no watch_stopped) and is idempotent", async () => {
    const { controller, starts, types } = makeController();
    controller.setDesired(true);
    starts[0].resolve();
    await flush();

    controller.dispose();
    expect(starts[0].removed).toBe(1);
    expect(types()).toEqual(["watch_started"]); // teardown is silent, distinct from stop

    controller.dispose(); // idempotent
    expect(starts[0].removed).toBe(1);
    controller.setDesired(true); // disposed → all ops are inert
    expect(starts).toHaveLength(1);
  });
});

describe("createWatchController — rejected-start recovery (spec §1)", () => {
  it("consumes a rejection (no throw), emits watch_start_rejected, and schedules exactly one retry", async () => {
    const { controller, starts, types, retryCount, fireRetry } = makeController();
    controller.setDesired(true);
    starts[0].reject();
    await flush();
    expect(types()).toEqual(["watch_start_rejected"]);
    expect(retryCount()).toBe(1); // single scheduled retry

    fireRetry();
    expect(starts).toHaveLength(2); // the timer started exactly one replacement
  });

  it("a reconcile signal retries immediately and cancels the pending retry timer", async () => {
    const { controller, starts, retryCount } = makeController();
    controller.setDesired(true);
    starts[0].reject();
    await flush();
    expect(retryCount()).toBe(1);

    controller.reconcile();
    expect(retryCount()).toBe(0); // timer cancelled
    expect(starts).toHaveLength(2); // immediate retry
  });

  it("blur/background before recovery cancels the scheduled retry", async () => {
    const { controller, starts, retryCount } = makeController();
    controller.setDesired(true);
    starts[0].reject();
    await flush();
    expect(retryCount()).toBe(1);

    controller.setDesired(false);
    expect(retryCount()).toBe(0);
    expect(starts).toHaveLength(1); // no retry while unwanted
  });

  it("repeated rejections retry at the fixed cadence without spinning or accumulating timers/starts", async () => {
    const { controller, starts, retryCount, fireRetry } = makeController();
    controller.setDesired(true);
    starts[0].reject();
    await flush();
    expect(retryCount()).toBe(1);

    fireRetry(); // → start #1
    expect(starts).toHaveLength(2);
    expect(retryCount()).toBe(0); // no timer while the new start is pending

    starts[1].reject();
    await flush();
    expect(retryCount()).toBe(1); // exactly one new timer, never two
    expect(starts).toHaveLength(2); // no extra concurrent start
  });

  it("dispose cancels a scheduled retry timer", async () => {
    const { controller, starts, retryCount, fireRetry } = makeController();
    controller.setDesired(true);
    starts[0].reject();
    await flush();
    expect(retryCount()).toBe(1);

    controller.dispose();
    expect(retryCount()).toBe(0);
    fireRetry(); // nothing scheduled → no-op
    expect(starts).toHaveLength(1);
  });

  it("reconcile while a live subscription exists does not start a duplicate", async () => {
    const { controller, starts } = makeController();
    controller.setDesired(true);
    starts[0].resolve();
    await flush();
    controller.reconcile();
    expect(starts).toHaveLength(1);
  });
});

describe("createWatchController — diagnostics are coordinate-free", () => {
  it("every emitted diagnostic event carries only its type (no coordinate can be smuggled in)", async () => {
    const { controller, starts, sink } = makeController();
    controller.setDesired(true);
    starts[0].resolve();
    await flush();
    starts[0].onFix(FIX);
    controller.stop();

    for (const [event] of sink.mock.calls) {
      expect(Object.keys(event)).toEqual(["type"]);
    }
    expect(sink.mock.calls.map(([e]) => e.type)).toEqual([
      "watch_started",
      "watch_fix_received",
      "watch_stopped",
    ]);
  });

  it("never logs to the console", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const { controller, starts } = makeController();
    controller.setDesired(true);
    starts[0].reject();
    await flush();
    starts[0].onFix?.(FIX);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("WATCH_RETRY_DELAY_MS", () => {
  it("is the fixed 30 s recovery cadence", () => {
    expect(WATCH_RETRY_DELAY_MS).toBe(30_000);
  });
});
