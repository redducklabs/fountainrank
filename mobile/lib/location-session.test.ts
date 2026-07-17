import { describe, expect, it, vi } from "vitest";

import type { FetchOutcome, RawPosition } from "./location";
import {
  createLocationSession,
  type LocationDiagnostics,
  type LocationSessionInputs,
} from "./location-session";
import type { StartWatch, TimerId, WatchHandle, WatchTimer } from "./location-watch";

const POS: RawPosition = { coords: { latitude: 1, longitude: 2, accuracy: 3 }, timestamp: 1_000 };
const GRANTED: FetchOutcome = { kind: "granted", position: POS };

const focusedActiveGranted: LocationSessionInputs = {
  focused: true,
  appActive: true,
  status: "granted",
};

function flush(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

type StartRecord = {
  onFix: (pos: RawPosition) => void;
  removed: number;
  resolve: () => void;
  reject: () => void;
};

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
  return { timer, count: () => jobs.size, fireAll: () => [...jobs.values()].forEach((fn) => fn()) };
}

function makeSession() {
  const { startWatch, starts } = makeStartHarness();
  const { timer, count, fireAll } = makeFakeTimer();
  const publishFix = vi.fn();
  const resetStore = vi.fn();
  const dispatch = vi.fn();
  const watchSink = vi.fn();
  const onAppActiveChange = vi.fn();
  const fetchOutcome = vi.fn<() => Promise<FetchOutcome>>();
  const diagnostics: LocationDiagnostics = { watchSink, onAppActiveChange };
  const session = createLocationSession(
    { startWatch, fetchOutcome, publishFix, resetStore, diagnostics, timer },
    { dispatch },
  );
  const sinkTypes = () => watchSink.mock.calls.map(([e]) => e.type);
  const dispatchTypes = () => dispatch.mock.calls.map(([e]) => e.type);
  return {
    session,
    starts,
    fetchOutcome,
    publishFix,
    resetStore,
    dispatch,
    dispatchTypes,
    onAppActiveChange,
    sinkTypes,
    timerCount: count,
    fireTimer: fireAll,
  };
}

describe("createLocationSession — watch lifecycle from inputs (spec §1)", () => {
  it("grant + focused + active starts the watch; a fix publishes to store and dispatches", async () => {
    const h = makeSession();
    h.session.setInputs(focusedActiveGranted);
    expect(h.starts).toHaveLength(1);
    h.starts[0].resolve();
    await flush();
    expect(h.sinkTypes()).toContain("watch_started");

    h.starts[0].onFix(POS);
    expect(h.publishFix).toHaveBeenCalledWith(POS);
    expect(h.dispatch).toHaveBeenCalledWith({
      type: "positionResolved",
      coords: { latitude: 1, longitude: 2, accuracy: 3 },
    });
  });

  it("does not start the watch unless focused AND active AND granted", () => {
    for (const inputs of [
      { focused: false, appActive: true, status: "granted" as const },
      { focused: true, appActive: false, status: "granted" as const },
      { focused: true, appActive: true, status: "denied" as const },
    ]) {
      const h = makeSession();
      h.session.setInputs(inputs);
      expect(h.starts).toHaveLength(0);
    }
  });

  it("blur stops the watch but does not dispose it; refocus restarts", async () => {
    const h = makeSession();
    h.session.setInputs(focusedActiveGranted);
    h.starts[0].resolve();
    await flush();

    h.session.setInputs({ focused: false, appActive: true, status: "granted" });
    expect(h.starts[0].removed).toBe(1);
    expect(h.sinkTypes()).toEqual(["watch_started", "watch_stopped"]);

    h.session.setInputs(focusedActiveGranted); // refocus
    expect(h.starts).toHaveLength(2);
    h.starts[1].resolve();
    await flush();
    h.starts[1].onFix(POS);
    expect(h.publishFix).toHaveBeenCalledTimes(1);
  });

  it("a deferred start resolving after blur is removed and never publishes", async () => {
    const h = makeSession();
    h.session.setInputs(focusedActiveGranted);
    h.session.setInputs({ focused: false, appActive: true, status: "granted" });
    h.starts[0].resolve();
    await flush();
    expect(h.starts[0].removed).toBe(1);
    h.starts[0].onFix(POS);
    expect(h.publishFix).not.toHaveBeenCalled();
  });

  it("notifies diagnostics on an AppState transition, never on the initial baseline", () => {
    const h = makeSession();
    h.session.setInputs(focusedActiveGranted); // baseline active — not a transition
    expect(h.onAppActiveChange).not.toHaveBeenCalled();
    h.session.setInputs({ focused: true, appActive: false, status: "granted" });
    expect(h.onAppActiveChange).toHaveBeenNthCalledWith(1, false);
    h.session.setInputs(focusedActiveGranted);
    expect(h.onAppActiveChange).toHaveBeenNthCalledWith(2, true);
  });
});

describe("createLocationSession — mount fix + refresh (spec §3)", () => {
  it("acquireInitialFix dispatches started then publishes the granted fix", async () => {
    const h = makeSession();
    h.fetchOutcome.mockResolvedValue(GRANTED);
    await h.session.acquireInitialFix();
    expect(h.dispatchTypes()).toEqual(["started", "positionResolved"]);
    expect(h.publishFix).toHaveBeenCalledWith(POS);
  });

  it("a successful refresh() publishes, returns the granted outcome, and reconciles the watch", async () => {
    const h = makeSession();
    // A start that rejects leaves the controller retryable with a scheduled retry timer.
    h.session.setInputs(focusedActiveGranted);
    h.starts[0].reject();
    await flush();
    expect(h.timerCount()).toBe(1);

    h.fetchOutcome.mockResolvedValue(GRANTED);
    const outcome = await h.session.refresh();

    expect(outcome).toEqual({
      kind: "granted",
      coords: { latitude: 1, longitude: 2, accuracy: 3 },
    });
    expect(h.publishFix).toHaveBeenCalledWith(POS);
    // reconcile() cancelled the retry timer and started the replacement immediately.
    expect(h.timerCount()).toBe(0);
    expect(h.starts).toHaveLength(2);
  });

  it("an in-flight refresh() resolving after dispose() performs no dispatch or publish", async () => {
    const h = makeSession();
    let resolveFetch!: (o: FetchOutcome) => void;
    h.fetchOutcome.mockReturnValue(new Promise<FetchOutcome>((r) => (resolveFetch = r)));

    const pending = h.session.refresh();
    h.session.dispose();
    resolveFetch(GRANTED);
    await pending;

    expect(h.publishFix).not.toHaveBeenCalled();
    expect(h.dispatch).not.toHaveBeenCalled();
  });
});

describe("createLocationSession — dispose", () => {
  it("dispose cancels an outstanding retry timer and inerts further inputs", async () => {
    const h = makeSession();
    h.session.setInputs(focusedActiveGranted);
    h.starts[0].reject();
    await flush();
    expect(h.timerCount()).toBe(1);

    h.session.dispose();
    expect(h.timerCount()).toBe(0);

    h.session.setInputs(focusedActiveGranted); // disposed → inert
    expect(h.starts).toHaveLength(1);
  });
});
