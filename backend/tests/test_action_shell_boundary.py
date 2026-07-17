"""Composite-action shell-injection boundary (spec 2026-07-17 §2d / plan Task 8).

Python-side validation of the marker components and namespace is too late if a GitHub expression
is interpolated directly into a ``run:`` script — the runner shell parses command substitutions
and metacharacters before argv exists. This static assertion pins the transport rule: action
inputs cross into the shell ONLY via the step's ``env:`` block (expressions are permitted there),
never inside a ``run:`` script body.
"""

from __future__ import annotations

from pathlib import Path

import yaml

_REPO_ROOT = Path(__file__).resolve().parents[2]
_ACTION_FILES = [
    _REPO_ROOT / ".github" / "actions" / "run-loader-job" / "action.yml",
    _REPO_ROOT / ".github" / "actions" / "teardown-loader-job" / "action.yml",
]


def test_no_github_expressions_inside_run_scripts():
    for path in _ACTION_FILES:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        steps = doc["runs"]["steps"]
        assert steps, f"{path}: no steps parsed"
        for step in steps:
            script = step.get("run")
            if script is None:
                continue
            assert "${{" not in script, (
                f"{path.name}: a GitHub expression is interpolated into a run script — "
                "map it through the step's env: block and use a double-quoted shell variable"
            )


def test_env_backed_variables_are_always_double_quoted():
    # A future edit changing "$JOB_NAME" to bare $JOB_NAME would reopen word-splitting/glob
    # injection at the shell boundary; pin the quoting, not just the env-transport rule.
    import re

    for path in _ACTION_FILES:
        doc = yaml.safe_load(path.read_text(encoding="utf-8"))
        for step in doc["runs"]["steps"]:
            script = step.get("run")
            if script is None:
                continue
            for var in step.get("env", {}):
                # Every reference must be double-quoted: either the exact "$VAR" token
                # (stripped first — this also handles nested `"$( ... "$VAR" ... )"` forms), or
                # embedded in a larger "...$VAR..." string (odd number of quotes before it).
                for line in script.splitlines():
                    stripped = line.replace(f'"${var}"', "")
                    for m in re.finditer(rf"\${{?{re.escape(var)}\b", stripped):
                        quotes_before = stripped[: m.start()].count('"')
                        assert quotes_before % 2 == 1, (
                            f"{path.name}: ${var} appears outside double quotes: {line.strip()}"
                        )


def test_marker_components_are_passed_not_composed():
    # The composed `loader:<job>:<run>` marker string must exist ONLY in
    # app/imports/loader_session.py — actions pass components.
    for path in _ACTION_FILES:
        content = path.read_text(encoding="utf-8")
        assert "loader:" not in content, f"{path.name}: composes the session marker in YAML"
