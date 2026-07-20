"""Teardown state-machine matrix (spec 2026-07-17 §2b, Verification 6).

Every branch of the guaranteed-teardown runs against an injected fake command runner + clock —
no cluster involved. The state machine is the central containment guarantee from the Spain
incident, so the abnormal paths (delete failure, absence timeout, flaky exec, malformed reaper
output, budget exhaustion) are pinned as executable tests, not review-only shell structure.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

from app.imports import loader_teardown as lt
from app.imports.loader_teardown import CommandResult, TeardownConfig, run_teardown

_OK_REAP = CommandResult(0, '{"terminated": 1, "remaining": 0}\n', "")
_ZERO_REAP = CommandResult(0, '{"terminated": 0, "remaining": 0}\n', "")


def _kind(args: list[str]) -> str:
    if "delete" in args:
        return "delete"
    if "get" in args:
        return "pods"
    if "exec" in args:
        return "exec"
    raise AssertionError(f"unexpected command: {args}")


class FakeEnv:
    """Scripted runner + clock. Each runner call advances the clock by `call_cost_s` (or by the
    granted timeout when the scripted response is the string 'timeout')."""

    def __init__(self, responses: dict[str, list], call_cost_s: float = 1.0):
        self.responses = {k: list(v) for k, v in responses.items()}
        self.calls: list[tuple[str, float]] = []
        self.sleeps: list[float] = []
        self.now = 0.0
        self.call_cost_s = call_cost_s

    def clock(self) -> float:
        return self.now

    def sleep(self, s: float) -> None:
        self.sleeps.append(s)
        self.now += s

    def runner(self, args: list[str], timeout_s: float) -> CommandResult:
        kind = _kind(args)
        self.calls.append((kind, timeout_s))
        queue = self.responses.get(kind, [])
        resp = queue.pop(0) if queue else queue_default(kind)
        if resp == "timeout":
            self.now += timeout_s
            raise TimeoutError("simulated subprocess timeout")
        if isinstance(resp, BaseException):
            self.now += self.call_cost_s
            raise resp
        self.now += self.call_cost_s
        return resp


def queue_default(kind: str) -> CommandResult:
    # Defaults keep unrelated phases healthy so each test isolates ONE failure.
    if kind == "delete":
        return CommandResult(0, "", "")
    if kind == "pods":
        return CommandResult(0, "", "")  # no pods -> absent
    return _OK_REAP


def _teardown(env: FakeEnv, config: TeardownConfig | None = None):
    return run_teardown(
        job_name="boundary-load",
        run_id="123456",
        namespace="fountainrank",
        runner=env.runner,
        clock=env.clock,
        sleep=env.sleep,
        config=config,
    )


def test_healthy_path_command_order_and_exit_zero():
    env = FakeEnv({"delete": [CommandResult(0, "", "")], "pods": [], "exec": [_OK_REAP]})
    code, report = _teardown(env)
    assert code == 0 and report["ok"] is True
    assert [k for k, _ in env.calls] == ["delete", "pods", "exec"]
    assert report["phases"]["requery"] == {"ok": True, "detail": "remaining=0"}
    assert report["marker"] == "loader:boundary-load:123456"


def test_zero_match_path_exit_zero():
    env = FakeEnv({"exec": [_ZERO_REAP]})
    code, report = _teardown(env)
    assert code == 0
    assert report["phases"]["reap"]["result"] == {"terminated": 0, "remaining": 0}


def test_reap_attempted_after_delete_failure_and_failure_preserved():
    env = FakeEnv({"delete": [CommandResult(1, "", "boom")], "exec": [_OK_REAP]})
    code, report = _teardown(env)
    # The reap still ran and succeeded...
    assert report["phases"]["reap"]["ok"] is True
    assert "exec" in [k for k, _ in env.calls]
    # ...but the later success never erases the earlier delete failure.
    assert report["phases"]["delete"]["ok"] is False
    assert code == 1 and report["ok"] is False


def test_unconfirmed_pod_absence_is_fatal_even_with_zero_remaining():
    pod_present = CommandResult(0, "pod/boundary-load-xyz\n", "")
    env = FakeEnv({"pods": [pod_present] * 10, "exec": [_ZERO_REAP]})
    code, report = _teardown(env)
    assert report["phases"]["pod_absence"]["ok"] is False
    assert report["phases"]["requery"]["ok"] is True  # remaining == 0
    assert code == 1 and report["ok"] is False


def test_absence_poll_retries_until_confirmed():
    pod_present = CommandResult(0, "pod/x\n", "")
    env = FakeEnv({"pods": [pod_present, pod_present, CommandResult(0, "", "")]})
    code, report = _teardown(env)
    assert code == 0
    assert report["phases"]["pod_absence"]["detail"] == "confirmed_after_attempt=3"
    assert [k for k, _ in env.calls].count("pods") == 3


def test_transient_exec_failure_recovers():
    env = FakeEnv({"exec": [CommandResult(1, "", "flake"), _OK_REAP]})
    code, report = _teardown(env)
    assert code == 0
    assert report["phases"]["reap"] == {
        "ok": True,
        "detail": "attempt=2",
        "result": {"terminated": 1, "remaining": 0},
    }
    # The backoff between attempts was honored.
    assert lt.REAPER_BACKOFF_SECONDS in env.sleeps


def test_permanently_unreachable_reaper_exhausts_retries_and_fails():
    env = FakeEnv({"exec": [CommandResult(1, "", "down")] * 10})
    code, report = _teardown(env)
    assert code == 1
    assert report["phases"]["reap"]["ok"] is False
    assert report["phases"]["requery"] == {"ok": False, "detail": "reaper_unavailable"}
    assert [k for k, _ in env.calls].count("exec") == lt.REAPER_ATTEMPTS


def test_malformed_reaper_json_is_attempt_failure():
    env = FakeEnv({"exec": [CommandResult(0, "not json at all\n", "")] * 10})
    code, report = _teardown(env)
    assert code == 1
    assert report["phases"]["reap"]["detail"] == "malformed_result"


def test_remaining_then_zero_succeeds():
    env = FakeEnv(
        {
            "exec": [
                CommandResult(0, '{"terminated": 2, "remaining": 1}\n', ""),
                CommandResult(0, '{"terminated": 0, "remaining": 0}\n', ""),
            ]
        }
    )
    code, report = _teardown(env)
    assert code == 0
    assert report["phases"]["requery"]["ok"] is True
    assert "remaining=0" in report["phases"]["requery"]["detail"]


def test_exhausted_requery_budget_fails():
    stuck = CommandResult(0, '{"terminated": 0, "remaining": 1}\n', "")
    first = CommandResult(0, '{"terminated": 1, "remaining": 1}\n', "")
    env = FakeEnv({"exec": [first] + [stuck] * 10})
    code, report = _teardown(env)
    assert code == 1
    assert report["phases"]["requery"]["ok"] is False
    # initial reap + requery_attempts re-runs, no more.
    assert [k for k, _ in env.calls].count("exec") == 1 + lt.REQUERY_ATTEMPTS


def test_multiple_simultaneous_failures_all_in_diagnostics():
    env = FakeEnv(
        {
            "delete": [CommandResult(1, "", "api down")],
            "pods": [CommandResult(1, "", "api down")] * 10,
            "exec": [CommandResult(1, "", "api down")] * 10,
        }
    )
    code, report = _teardown(env)
    assert code == 1
    assert report["phases"]["delete"]["ok"] is False
    assert report["phases"]["pod_absence"]["ok"] is False
    assert report["phases"]["reap"]["ok"] is False
    assert report["phases"]["requery"]["ok"] is False


def test_no_secrets_in_report():
    env = FakeEnv({})
    _, report = _teardown(env)
    dumped = json.dumps(report).lower()
    for needle in ("postgresql://", "password", "token", "secret"):
        assert needle not in dumped


def test_production_defaults_fit_platform_window():
    assert lt.GLOBAL_DEADLINE_SECONDS == 210.0
    assert lt.FINALIZATION_RESERVE_SECONDS == 10.0
    # The FULL serial arithmetic — command timeouts AND inter-attempt sleeps (the absence loop
    # does not sleep after its final attempt; the re-query loop sleeps before every attempt).
    serial_worst = (
        lt.DELETE_TIMEOUT_SECONDS
        + lt.ABSENCE_POLL_ATTEMPTS * lt.ABSENCE_POLL_INTERVAL_SECONDS
        + (lt.ABSENCE_POLL_ATTEMPTS - 1) * lt.ABSENCE_POLL_INTERVAL_SECONDS
        + lt.REAPER_ATTEMPTS * lt.REAPER_TIMEOUT_SECONDS
        + (lt.REAPER_ATTEMPTS - 1) * lt.REAPER_BACKOFF_SECONDS
        + lt.REQUERY_ATTEMPTS * (lt.REQUERY_TIMEOUT_SECONDS + lt.REQUERY_INTERVAL_SECONDS)
    )
    assert serial_worst == 195.0
    assert serial_worst <= lt.GLOBAL_DEADLINE_SECONDS - lt.FINALIZATION_RESERVE_SECONDS
    assert lt.GLOBAL_DEADLINE_SECONDS < 300  # GitHub's 5-minute post-cancellation window
    # The absence phase ceiling (polls + sleeps) must exceed the loader pod's termination grace,
    # or every cancellation reports a spurious pod_absence failure (#250).
    from app.imports.loader_job_render import render_job

    manifest = render_job(
        job_name="boundary-load",
        image="img:1",
        namespace="fountainrank",
        session_marker="loader:boundary-load:1",
        argv=["python"],
        files=[{"local": "/t", "container": "/work/x"}],
        mem_request="256Mi",
        mem_limit="1Gi",
        cpu_request="100m",
        cpu_limit="1",
        active_deadline_seconds=5400,
        ready_timeout_seconds=600,
    )
    grace = manifest["spec"]["template"]["spec"]["terminationGracePeriodSeconds"]
    absence_ceiling = (
        lt.ABSENCE_POLL_ATTEMPTS * lt.ABSENCE_POLL_INTERVAL_SECONDS
        + (lt.ABSENCE_POLL_ATTEMPTS - 1) * lt.ABSENCE_POLL_INTERVAL_SECONDS
    )
    assert absence_ceiling > grace + 10  # headroom for kubelet/API lag


def test_absence_loop_does_not_sleep_after_final_attempt():
    pod_present = CommandResult(0, "pod/x\n", "")
    env = FakeEnv({"pods": [pod_present] * 10, "exec": [_ZERO_REAP]})
    _teardown(env)
    pods_calls = [k for k, _ in env.calls].count("pods")
    assert pods_calls == lt.ABSENCE_POLL_ATTEMPTS
    # Sleeps attributable to the absence phase: attempts - 1 (none after the last poll). The
    # only other sleeps in this scenario would be reaper backoff (reap succeeds first try).
    assert env.sleeps.count(lt.ABSENCE_POLL_INTERVAL_SECONDS) == lt.ABSENCE_POLL_ATTEMPTS - 1


@pytest.mark.parametrize("failing_kind", ["delete", "pods", "exec"])
def test_launch_error_is_contained_and_later_phases_still_run(failing_kind):
    env = FakeEnv({failing_kind: [FileNotFoundError("kubectl not found")] * 10})
    code, report = _teardown(env)
    assert code == 1
    kinds = [k for k, _ in env.calls]
    # Every phase was still attempted — a launch failure never short-circuits containment.
    assert "delete" in kinds and "pods" in kinds and "exec" in kinds
    failing_phase = {"delete": "delete", "pods": "pod_absence", "exec": "reap"}[failing_kind]
    assert report["phases"][failing_phase]["ok"] is False
    assert "launch_error:FileNotFoundError" in report["phases"][failing_phase]["detail"]


def test_launch_error_then_recovery_in_reaper():
    env = FakeEnv({"exec": [PermissionError("denied"), _OK_REAP]})
    code, report = _teardown(env)
    assert code == 0
    assert report["phases"]["reap"] == {
        "ok": True,
        "detail": "attempt=2",
        "result": {"terminated": 1, "remaining": 0},
    }


def test_launch_error_in_requery_is_recorded():
    first = CommandResult(0, '{"terminated": 1, "remaining": 1}\n', "")
    env = FakeEnv({"exec": [first] + [OSError("exec plumbing")] * 10})
    code, report = _teardown(env)
    assert code == 1
    assert report["phases"]["requery"]["ok"] is False
    assert "launch_error:OSError" in report["phases"]["requery"]["detail"]


def test_global_deadline_caps_attempt_timeouts_and_is_never_exceeded():
    # Every scripted call times out at its granted timeout — the slowest possible world.
    env = FakeEnv(
        {"delete": ["timeout"], "pods": ["timeout"] * 20, "exec": ["timeout"] * 20},
    )
    config = TeardownConfig(deadline_s=50.0, reserve_s=10.0)
    code, report = _teardown(env, config)
    assert code == 1
    # First attempt got min(nominal 30, available 40) = 30; later phases got REDUCED timeouts.
    assert env.calls[0] == ("delete", 30.0)
    assert all(t <= 40.0 for _, t in env.calls)
    later = [t for kind, t in env.calls if kind != "delete"]
    assert later and all(t < 30.0 for t in later)
    # The clock never passed the hard deadline before final reporting.
    assert env.now <= config.deadline_s
    # Exhausted phases say so rather than silently passing.
    exhausted = [p for p in report["phases"].values() if p["detail"] == "budget_exhausted"]
    assert exhausted


def test_insufficient_budget_skips_to_final_failure_without_attempts():
    env = FakeEnv({"delete": ["timeout"]})
    # available = 12 - 10 = 2 -> the delete gets a 2 s attempt; after it times out, remaining
    # budget is below the minimum attempt -> everything else records budget_exhausted with NO
    # further subprocess calls.
    config = TeardownConfig(deadline_s=12.0, reserve_s=10.0)
    code, report = _teardown(env, config)
    assert code == 1
    assert env.calls == [("delete", 2.0)]
    assert report["phases"]["pod_absence"]["detail"] == "budget_exhausted"
    assert report["phases"]["reap"]["detail"] == "budget_exhausted"
    assert env.now <= config.deadline_s


@pytest.mark.parametrize(
    "namespace",
    ["", "UPPER", "has space", "a;b", "a$(id)", "a`id`", "a\nb", "-lead", "trail-"],
)
def test_adversarial_namespace_rejected_before_any_subprocess(namespace):
    env = FakeEnv({})
    with pytest.raises(ValueError):
        run_teardown(
            job_name="boundary-load",
            run_id="1",
            namespace=namespace,
            runner=env.runner,
            clock=env.clock,
            sleep=env.sleep,
        )
    assert env.calls == []


@pytest.mark.parametrize(
    ("job_name", "run_id"),
    [("not-a-loader", "1"), ("boundary-load", "abc"), ("boundary load; id", "1")],
)
def test_adversarial_marker_components_rejected(job_name, run_id):
    env = FakeEnv({})
    with pytest.raises(ValueError):
        run_teardown(
            job_name=job_name,
            run_id=run_id,
            namespace="fountainrank",
            runner=env.runner,
            clock=env.clock,
            sleep=env.sleep,
        )
    assert env.calls == []


def test_runner_side_invocation_from_repo_root():
    repo_root = Path(__file__).resolve().parents[2]
    env = {**os.environ, "PYTHONPATH": "backend"}
    out = subprocess.check_output(
        [sys.executable, "-m", "app.imports.loader_teardown", "--help"],
        cwd=repo_root,
        env=env,
        text=True,
    )
    assert "--job-name" in out and "--namespace" in out
