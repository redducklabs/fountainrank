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


def test_marker_components_are_passed_not_composed():
    # The composed `loader:<job>:<run>` marker string must exist ONLY in
    # app/imports/loader_session.py — actions pass components.
    for path in _ACTION_FILES:
        content = path.read_text(encoding="utf-8")
        assert "loader:" not in content, f"{path.name}: composes the session marker in YAML"
