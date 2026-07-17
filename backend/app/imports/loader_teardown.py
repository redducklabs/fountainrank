"""Guaranteed-teardown state machine for the isolated loader Jobs (spec 2026-07-17 §2b).

Replaces the workflows' single ``kubectl delete job`` teardown line. A killed loader Job's
PostgreSQL session can keep executing server-side; this state machine deletes the Job, confirms
the pod is actually gone, reaps the run's database sessions (via ``kubectl exec`` into the
serving backend running :mod:`app.imports.session_reaper`), and re-queries to zero — recording
every phase's status and failing loudly if ANY phase failed.

**The platform sets the budget**: GitHub Actions force-terminates a cancelled job's cleanup after
a 5-minute grace period. The whole state machine therefore runs under a hard
``GLOBAL_DEADLINE_SECONDS`` (210 s) wall-clock deadline with a ``FINALIZATION_RESERVE_SECONDS``
(10 s) reserve that is never lent to subprocesses or sleeps: every attempt timeout is capped by
``deadline − now − reserve``, an attempt that cannot fit is skipped straight to final structured
failure, and diagnostics + exit always happen before the deadline.

Stdlib-only (with :mod:`app.imports.loader_session`); the single supported invocation is
``PYTHONPATH=backend python3 -m app.imports.loader_teardown`` from the repository root, via the
``teardown-loader-job`` composite action. The command runner and clock are injectable so every
branch is unit-testable without a cluster.

Design invariants (each pinned by tests):
- phases never short-circuit each other; a later success never erases an earlier failure;
- reaping is attempted even when Job deletion or pod-absence confirmation failed;
- unconfirmed pod absence is fatal even with zero remaining sessions (a live loader process
  could reconnect afterwards — the run-scoped marker makes that attributable and re-reapable);
- diagnostics carry identifiers and statuses only, never secrets.
"""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import time
from collections.abc import Callable
from dataclasses import dataclass

from app.imports.loader_session import compose_session_marker

# Production constants (asserted by test; the serial worst case ~185 s < 210 s < the 5-minute
# platform window). Tests inject shortened values through TeardownConfig.
GLOBAL_DEADLINE_SECONDS = 210.0
FINALIZATION_RESERVE_SECONDS = 10.0
DELETE_TIMEOUT_SECONDS = 30.0
ABSENCE_POLL_ATTEMPTS = 3
ABSENCE_POLL_INTERVAL_SECONDS = 5.0
REAPER_ATTEMPTS = 3
REAPER_TIMEOUT_SECONDS = 20.0
REAPER_BACKOFF_SECONDS = 5.0
REQUERY_ATTEMPTS = 3
REQUERY_TIMEOUT_SECONDS = 15.0
REQUERY_INTERVAL_SECONDS = 5.0

_NAMESPACE_RE = re.compile(r"^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$")

# Minimum seconds worth attempting a subprocess in; below this, skip to final failure.
_MIN_ATTEMPT_SECONDS = 1.0


@dataclass(frozen=True)
class CommandResult:
    returncode: int
    stdout: str
    stderr: str


# runner(args, timeout_s) -> CommandResult; raises TimeoutError on subprocess timeout.
Runner = Callable[[list[str], float], CommandResult]


def _subprocess_runner(args: list[str], timeout_s: float) -> CommandResult:
    try:
        proc = subprocess.run(args, capture_output=True, text=True, timeout=timeout_s)
    except subprocess.TimeoutExpired as exc:
        raise TimeoutError(str(exc)) from exc
    return CommandResult(proc.returncode, proc.stdout, proc.stderr)


@dataclass(frozen=True)
class TeardownConfig:
    deadline_s: float = GLOBAL_DEADLINE_SECONDS
    reserve_s: float = FINALIZATION_RESERVE_SECONDS
    delete_timeout_s: float = DELETE_TIMEOUT_SECONDS
    absence_attempts: int = ABSENCE_POLL_ATTEMPTS
    absence_interval_s: float = ABSENCE_POLL_INTERVAL_SECONDS
    reaper_attempts: int = REAPER_ATTEMPTS
    reaper_timeout_s: float = REAPER_TIMEOUT_SECONDS
    reaper_backoff_s: float = REAPER_BACKOFF_SECONDS
    requery_attempts: int = REQUERY_ATTEMPTS
    requery_timeout_s: float = REQUERY_TIMEOUT_SECONDS
    requery_interval_s: float = REQUERY_INTERVAL_SECONDS


class _Budget:
    """Wall-clock budget: attempt timeouts and sleeps are capped by remaining − reserve."""

    def __init__(self, config: TeardownConfig, clock: Callable[[], float]):
        self._config = config
        self._clock = clock
        self._start = clock()

    def attempt_timeout(self, nominal_s: float) -> float | None:
        """The timeout an attempt may use now, or None if it cannot fit before the reserve."""
        available = self._config.deadline_s - (self._clock() - self._start) - self._config.reserve_s
        usable = min(nominal_s, available)
        return usable if usable >= _MIN_ATTEMPT_SECONDS else None

    def sleep_for(self, nominal_s: float) -> float:
        available = self._config.deadline_s - (self._clock() - self._start) - self._config.reserve_s
        return max(0.0, min(nominal_s, available))


def run_teardown(
    *,
    job_name: str,
    run_id: str,
    namespace: str,
    runner: Runner | None = None,
    clock: Callable[[], float] = time.monotonic,
    sleep: Callable[[float], None] = time.sleep,
    config: TeardownConfig | None = None,
) -> tuple[int, dict]:
    """Run the full teardown; return ``(exit_code, report)``. Never raises for phase failures."""
    marker = compose_session_marker(job_name, run_id)  # validates components
    if not _NAMESPACE_RE.fullmatch(namespace):
        raise ValueError(f"invalid namespace: {namespace!r}")
    runner = runner or _subprocess_runner
    config = config or TeardownConfig()
    budget = _Budget(config, clock)
    phases: dict[str, dict] = {}

    def _run(args: list[str], nominal_timeout_s: float) -> CommandResult | str:
        timeout_s = budget.attempt_timeout(nominal_timeout_s)
        if timeout_s is None:
            return "budget_exhausted"
        try:
            return runner(args, timeout_s)
        except TimeoutError:
            return "timeout"
        except (OSError, subprocess.SubprocessError) as exc:
            # A launch failure (kubectl missing, permission, exec plumbing) must become a
            # structured attempt result — never an exception that aborts the later containment
            # phases. Deliberately narrow: a programming error still raises.
            return f"launch_error:{type(exc).__name__}"

    # Phase 1 — delete the Job (one attempt; ignore-not-found makes it idempotent).
    kubectl_timeout = max(1, int(config.delete_timeout_s) - 2)
    result = _run(
        [
            "kubectl",
            "-n",
            namespace,
            "delete",
            "job",
            job_name,
            "--ignore-not-found",
            "--wait",
            f"--timeout={kubectl_timeout}s",
        ],
        config.delete_timeout_s,
    )
    if isinstance(result, str):
        phases["delete"] = {"ok": False, "detail": result}
    else:
        phases["delete"] = {"ok": result.returncode == 0, "detail": f"rc={result.returncode}"}

    # Phase 2 — confirm pod ABSENCE (bounded polls). Never skipped by phase-1 failure.
    selector = f"batch.kubernetes.io/job-name={job_name}"
    absent = False
    detail = "not_attempted"
    for attempt in range(config.absence_attempts):
        result = _run(
            ["kubectl", "-n", namespace, "get", "pods", "-l", selector, "-o", "name"],
            config.absence_interval_s,
        )
        if isinstance(result, str):
            detail = result
            if result == "budget_exhausted":
                break
        elif result.returncode == 0 and not result.stdout.strip():
            absent = True
            detail = f"confirmed_after_attempt={attempt + 1}"
            break
        else:
            detail = f"rc={result.returncode} pods={bool(result.stdout.strip())}"
        if attempt + 1 < config.absence_attempts:  # no sleep after the final attempt
            sleep(budget.sleep_for(config.absence_interval_s))
    phases["pod_absence"] = {"ok": absent, "detail": detail}

    # Phase 3 — reap this run's DB sessions (retries; independent of phases 1-2).
    reaper_args = [
        "kubectl",
        "-n",
        namespace,
        "exec",
        "deploy/fountainrank-backend",
        "--",
        "python",
        "-m",
        "app.imports.session_reaper",
        "--job-name",
        job_name,
        "--run-id",
        run_id,
    ]

    def _reap_once(timeout_s: float) -> dict | str:
        outcome = _run(reaper_args, timeout_s)
        if isinstance(outcome, str):
            return outcome
        if outcome.returncode != 0:
            return f"rc={outcome.returncode}"
        lines = [ln for ln in outcome.stdout.strip().splitlines() if ln.strip()]
        try:
            parsed = json.loads(lines[-1]) if lines else None
        except json.JSONDecodeError:
            parsed = None
        if not isinstance(parsed, dict) or "remaining" not in parsed:
            return "malformed_result"
        return parsed

    reap: dict | None = None
    detail = "not_attempted"
    for attempt in range(config.reaper_attempts):
        outcome = _reap_once(config.reaper_timeout_s)
        if isinstance(outcome, dict):
            reap = outcome
            detail = f"attempt={attempt + 1}"
            break
        detail = outcome
        if outcome == "budget_exhausted":
            break
        sleep(budget.sleep_for(config.reaper_backoff_s))
    phases["reap"] = {"ok": reap is not None, "detail": detail, "result": reap}

    # Phase 4 — re-query to zero (covers the terminate race / a straggler pooled connection).
    remaining = reap.get("remaining") if reap else None
    if reap is not None and remaining != 0:
        detail = f"remaining={remaining}"
        for attempt in range(config.requery_attempts):
            sleep(budget.sleep_for(config.requery_interval_s))
            outcome = _reap_once(config.requery_timeout_s)
            if isinstance(outcome, dict):
                remaining = outcome.get("remaining")
                detail = f"attempt={attempt + 1} remaining={remaining}"
                if remaining == 0:
                    break
            else:
                detail = outcome
                if outcome == "budget_exhausted":
                    break
        phases["requery"] = {"ok": remaining == 0, "detail": detail}
    elif reap is not None:
        phases["requery"] = {"ok": True, "detail": "remaining=0"}
    else:
        phases["requery"] = {"ok": False, "detail": "reaper_unavailable"}

    ok = all(p["ok"] for p in phases.values())
    report = {
        "job_name": job_name,
        "run_id": run_id,
        "namespace": namespace,
        "marker": marker,
        "phases": phases,
        "ok": ok,
    }
    return (0 if ok else 1), report


def main(argv: list[str] | None = None) -> int:
    p = argparse.ArgumentParser(prog="app.imports.loader_teardown")
    p.add_argument("--job-name", required=True)
    p.add_argument("--run-id", required=True)
    p.add_argument("--namespace", required=True)
    a = p.parse_args(argv)
    try:
        exit_code, report = run_teardown(
            job_name=a.job_name, run_id=a.run_id, namespace=a.namespace
        )
    except ValueError as exc:
        p.error(str(exc))
        raise AssertionError("unreachable") from exc
    print(json.dumps(report))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
