import { describe, expect, it, vi } from "vitest";

import { createFixStore, type Coords, type FetchOutcome, type RawPosition } from "./location";
import {
  createLocationSession,
  openSettingsEffect,
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
  // Default: the store accepts the fix and has no prior stored coords, so the session dispatches the
  // fix's own coords. Ordering/cross-session tests use a real `createFixStore` instead.
  const publishFix = vi.fn<(pos: RawPosition) => boolean>().mockReturnValue(true);
  const latestStoredCoords = vi.fn<() => Coords | null>().mockReturnValue(null);
  const resetStore = vi.fn();
  const openSettings = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const dispatch = vi.fn();
  const watchSink = vi.fn();
  const onAppActiveChange = vi.fn();
  const fetchOutcome = vi.fn<() => Promise<FetchOutcome>>();
  const diagnostics: LocationDiagnostics = { watchSink, onAppActiveChange };
  const session = createLocationSession(
    {
      startWatch,
      fetchOutcome,
      publishFix,
      latestStoredCoords,
      resetStore,
      openSettings,
      diagnostics,
      timer,
    },
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
    openSettings,
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

const DENIED_REPROMPTABLE: FetchOutcome = { kind: "denied", canAskAgain: true };
const DENIED_PERMANENT: FetchOutcome = { kind: "denied", canAskAgain: false };
const UNAVAILABLE: FetchOutcome = { kind: "unavailable" };

describe("createLocationSession — denied-clearing across ALL producers (spec §3)", () => {
  it("initial denial (mount): permissionDenied, store reset, watch not desired, no coordinate logged", async () => {
    const spies = [
      vi.spyOn(console, "log").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
    ];
    const h = makeSession();
    h.fetchOutcome.mockResolvedValue(DENIED_REPROMPTABLE);
    await h.session.acquireInitialFix();

    expect(h.dispatchTypes()).toEqual(["started", "permissionDenied"]);
    expect(h.resetStore).toHaveBeenCalledTimes(1);
    // Even if inputs later say granted, a denied status keeps desired false via the input flow;
    // here the session itself never started a watch.
    expect(h.starts).toHaveLength(0);
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });

  it("refresh denial returns the rich outcome (both canAskAgain values) and clears the store", async () => {
    for (const outcome of [DENIED_REPROMPTABLE, DENIED_PERMANENT]) {
      const h = makeSession();
      h.fetchOutcome.mockResolvedValue(outcome);
      const result = await h.session.refresh();
      expect(result).toEqual({ kind: "denied", canAskAgain: outcome.canAskAgain });
      expect(h.dispatchTypes()).toEqual(["permissionDenied"]);
      expect(h.resetStore).toHaveBeenCalledTimes(1);
    }
  });

  it("denial after a prior granted fix clears the store and STOPS the live watch", async () => {
    const h = makeSession();
    // Establish a running watch + a known fix.
    h.session.setInputs(focusedActiveGranted);
    h.starts[0].resolve();
    await flush();
    h.starts[0].onFix(POS);
    expect(h.publishFix).toHaveBeenCalledTimes(1);

    h.fetchOutcome.mockResolvedValue(DENIED_REPROMPTABLE);
    await h.session.refresh();

    expect(h.resetStore).toHaveBeenCalledTimes(1);
    expect(h.starts[0].removed).toBe(1); // controller.setDesired(false) removed the live subscription
    expect(h.sinkTypes()).toContain("watch_stopped");
  });
});

describe("createLocationSession — unavailable keeps a known-good fix (spec §3)", () => {
  it("a refresh unavailable AFTER a known fix does not dispatch failed or reset the store", async () => {
    const h = makeSession();
    h.fetchOutcome.mockResolvedValue(GRANTED);
    await h.session.acquireInitialFix(); // knownCoords now set
    h.dispatch.mockClear();

    h.fetchOutcome.mockResolvedValue(UNAVAILABLE);
    const result = await h.session.refresh();

    expect(result).toEqual({ kind: "unavailable" });
    expect(h.dispatch).not.toHaveBeenCalled(); // no 'failed' — the known-good fix is preserved
    expect(h.resetStore).not.toHaveBeenCalled();
  });

  it("a refresh unavailable with NO known fix dispatches failed", async () => {
    const h = makeSession();
    h.fetchOutcome.mockResolvedValue(UNAVAILABLE);
    const result = await h.session.refresh();
    expect(result).toEqual({ kind: "unavailable" });
    expect(h.dispatchTypes()).toEqual(["failed"]);
  });
});

describe("createLocationSession — publish sources (spec §3)", () => {
  it("mount, refresh, and watch fixes all publish to the store", async () => {
    const h = makeSession();
    h.fetchOutcome.mockResolvedValue(GRANTED);
    await h.session.acquireInitialFix(); // mount publish
    await h.session.refresh(); // refresh publish
    h.session.setInputs(focusedActiveGranted);
    h.starts[0].resolve();
    await flush();
    h.starts[0].onFix(POS); // watch publish
    expect(h.publishFix).toHaveBeenCalledTimes(3);
  });
});

describe("openSettingsEffect + session.openSettings (spec §3)", () => {
  it("resolves opened when the platform open() succeeds", async () => {
    await expect(openSettingsEffect(async () => undefined)).resolves.toEqual({ kind: "opened" });
  });

  it("maps a rejection to failed (never throws) — the plain-replacement-toast decision", async () => {
    await expect(
      openSettingsEffect(async () => {
        throw new Error("cannot open settings");
      }),
    ).resolves.toEqual({ kind: "failed" });
  });

  it("session.openSettings delegates to the injected platform adapter", async () => {
    const h = makeSession();
    await expect(h.session.openSettings()).resolves.toEqual({ kind: "opened" });
    expect(h.openSettings).toHaveBeenCalledTimes(1);
  });

  it("session.openSettings maps an adapter rejection to failed", async () => {
    const h = makeSession();
    h.openSettings.mockRejectedValue(new Error("boom"));
    await expect(h.session.openSettings()).resolves.toEqual({ kind: "failed" });
  });
});

/** A mutable injected clock so the real fix store's ordering is deterministic. */
function makeClock(start = 0) {
  let t = start;
  const clock = () => t;
  clock.set = (value: number) => {
    t = value;
  };
  return clock;
}

const NEW_COORDS: Coords = { latitude: 10, longitude: 20, accuracy: 1 };
const OLD_COORDS: Coords = { latitude: 30, longitude: 40, accuracy: 1 };

/** A session wired to a REAL fix store so acceptance/ordering is genuine (a vi.fn cannot expose the
 *  split-brain). Returns the store + a `dispatch` spy + a controllable `fetchOutcome`. */
function makeStoreBackedSession(store: ReturnType<typeof createFixStore>) {
  const dispatch = vi.fn();
  const { startWatch, starts } = makeStartHarness();
  const { timer } = makeFakeTimer();
  const fetchOutcome = vi.fn<() => Promise<FetchOutcome>>();
  const diagnostics: LocationDiagnostics = { watchSink: vi.fn(), onAppActiveChange: vi.fn() };
  const session = createLocationSession(
    {
      startWatch,
      fetchOutcome,
      publishFix: store.publishFix,
      latestStoredCoords: store.latestStoredCoords,
      resetStore: store.resetLatestFix,
      openSettings: vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
      diagnostics,
      timer,
    },
    { dispatch },
  );
  const dispatchedLatitudes = () =>
    dispatch.mock.calls
      .filter(([e]) => e.type === "positionResolved")
      .map(([e]) => ("coords" in e ? (e.coords as Coords).latitude : undefined));
  return {
    session,
    starts,
    fetchOutcome,
    dispatch,
    dispatchTypes: () => dispatch.mock.calls.map(([e]) => e.type),
    dispatchedLatitudes,
  };
}

describe("createLocationSession — reducer stays consistent with the store (no split-brain, spec §2/§3)", () => {
  it("an older-effective refresh settling after a newer watch fix does NOT regress the reducer", async () => {
    const clock = makeClock();
    const store = createFixStore(clock);
    const h = makeStoreBackedSession(store);

    // A newer watch fix (source 2000) arrives and is accepted → dispatched.
    clock.set(2_000);
    h.session.setInputs(focusedActiveGranted);
    h.starts[0].resolve();
    await flush();
    h.starts[0].onFix({ coords: NEW_COORDS, timestamp: 2_000 });
    expect(h.dispatch).toHaveBeenCalledWith({ type: "positionResolved", coords: NEW_COORDS });

    // A slow refresh with an OLDER source (1000) settles second → the store rejects it.
    clock.set(3_000);
    h.fetchOutcome.mockResolvedValue({
      kind: "granted",
      position: { coords: OLD_COORDS, timestamp: 1_000 },
    });
    const outcome = await h.session.refresh();

    // The reducer was NEVER told the older coords (checked by value), and the refresh returns the
    // store-newest fix, not the stale-ordered one.
    expect(h.dispatchedLatitudes()).not.toContain(OLD_COORDS.latitude);
    expect(outcome).toEqual({ kind: "granted", coords: NEW_COORDS });
  });

  it("cross-session: a fresh session whose OLDER initial fix is rejected still resolves to the store-newest and EXITS locating", async () => {
    const clock = makeClock();
    const store = createFixStore(clock);
    // A prior (disposed) session left a NEWER fix in the process-wide store.
    clock.set(2_000);
    store.publishFix({ coords: NEW_COORDS, timestamp: 2_000 });

    // A fresh session (knownCoords === null) whose initial fetch yields an OLDER fix.
    const h = makeStoreBackedSession(store);
    clock.set(3_000);
    h.fetchOutcome.mockResolvedValue({
      kind: "granted",
      position: { coords: OLD_COORDS, timestamp: 1_000 },
    });
    const outcome = await h.session.acquireInitialFix();

    // Acquisition MUST exit "locating": positionResolved dispatched with the store-newest coords,
    // and the rich outcome returns those — never the stale older fix, never a stuck "locating".
    expect(h.dispatchTypes()).toEqual(["started", "positionResolved"]);
    expect(h.dispatch).toHaveBeenCalledWith({ type: "positionResolved", coords: NEW_COORDS });
    expect(h.dispatchedLatitudes()).not.toContain(OLD_COORDS.latitude);
    expect(outcome).toEqual({ kind: "granted", coords: NEW_COORDS });
  });

  it("a granted fix with a non-finite timestamp (store empty) still exits locating via the raw position", async () => {
    const clock = makeClock(5_000);
    const store = createFixStore(clock); // empty
    const h = makeStoreBackedSession(store);
    const RAW: Coords = { latitude: 47.6, longitude: -122.3, accuracy: 5 };
    h.fetchOutcome.mockResolvedValue({
      kind: "granted",
      position: { coords: RAW, timestamp: Number.NaN },
    });
    const outcome = await h.session.acquireInitialFix();

    // Unusable timestamp + empty store → fall back to the raw position, but STILL dispatch so the
    // granted fix leaves "locating".
    expect(h.dispatchTypes()).toEqual(["started", "positionResolved"]);
    expect(outcome).toEqual({ kind: "granted", coords: RAW });
  });
});

describe("createLocationSession — single-flight across acquisition AND refresh (spec §3)", () => {
  it("a refresh while the mount acquisition is in flight is a no-op (no second fetch)", async () => {
    const h = makeSession();
    let resolveAcquire!: (o: FetchOutcome) => void;
    h.fetchOutcome.mockReturnValueOnce(new Promise<FetchOutcome>((r) => (resolveAcquire = r)));

    const acquiring = h.session.acquireInitialFix(); // fetch in flight (status "locating")
    const pressResult = await h.session.refresh(); // a locating-state press

    expect(pressResult).toEqual({ kind: "unavailable" });
    expect(h.fetchOutcome).toHaveBeenCalledTimes(1); // ONLY the acquisition fetch — no concurrent one

    resolveAcquire(GRANTED);
    await acquiring;
  });

  it("a refresh while another refresh is in flight is a no-op", async () => {
    const h = makeSession();
    let resolveFirst!: (o: FetchOutcome) => void;
    h.fetchOutcome.mockReturnValueOnce(new Promise<FetchOutcome>((r) => (resolveFirst = r)));

    const first = h.session.refresh();
    const second = await h.session.refresh();

    expect(second).toEqual({ kind: "unavailable" });
    expect(h.fetchOutcome).toHaveBeenCalledTimes(1);

    resolveFirst(GRANTED);
    await first;
  });
});
