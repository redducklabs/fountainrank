from datetime import UTC, datetime, timedelta

from app.consensus import derive_consensus

T0 = datetime(2026, 1, 1, tzinfo=UTC)


def _ts(n: int) -> datetime:
    return T0 + timedelta(hours=n)


def _obs(*pairs):
    # pairs: (value, hour_offset)
    return [(v, _ts(h)) for (v, h) in pairs]


def test_boolean_strong_yes_high():
    r = derive_consensus("boolean", _obs(("yes", 0), ("yes", 1), ("yes", 2)))
    assert r.consensus_value == "yes"
    assert r.confidence == "high"
    assert r.yes_count == 3 and r.no_count == 0
    assert r.observation_count == 3


def test_boolean_two_one_medium():
    r = derive_consensus("boolean", _obs(("yes", 0), ("yes", 1), ("no", 2)))
    assert r.consensus_value == "yes"
    assert r.confidence == "medium"


def test_boolean_single_low():
    r = derive_consensus("boolean", _obs(("yes", 0)))
    assert r.consensus_value == "yes"
    assert r.confidence == "low"


def test_boolean_tie_is_mixed_and_not_filterable():
    r = derive_consensus("boolean", _obs(("no", 0), ("yes", 1)))
    assert r.consensus_value is None  # never matches a positive filter
    assert r.confidence == "mixed"
    assert r.latest_observation_value == "yes"  # most recent, UI only
    assert r.yes_count == 1 and r.no_count == 1


def test_all_unknown_is_none():
    r = derive_consensus("boolean", _obs(("unknown", 0), ("unknown", 1)))
    assert r.consensus_value is None
    assert r.confidence == "none"
    assert r.unknown_count == 2 and r.observation_count == 2
    assert r.latest_observation_value is None


def test_no_observations_is_none():
    r = derive_consensus("boolean", [])
    assert r.consensus_value is None and r.confidence == "none"
    assert r.observation_count == 0


def test_unknown_does_not_decide_but_is_counted():
    r = derive_consensus("boolean", _obs(("yes", 0), ("unknown", 1)))
    assert r.consensus_value == "yes"
    assert r.unknown_count == 1
    assert r.latest_observation_value == "yes"  # ignores the unknown


def test_enum_plurality_high():
    r = derive_consensus("enum", _obs(("park", 0), ("park", 1), ("park", 2), ("store", 3)))
    assert r.consensus_value == "park"
    assert r.confidence == "high"
    assert r.value_counts == {"park": 3, "store": 1}


def test_enum_tie_is_mixed():
    r = derive_consensus("enum", _obs(("park", 0), ("store", 1)))
    assert r.consensus_value is None
    assert r.confidence == "mixed"
    assert r.value_counts == {"park": 1, "store": 1}


def test_enum_latest_independent_of_winner():
    # park wins on count, but the latest known value is store.
    r = derive_consensus("enum", _obs(("park", 0), ("park", 1), ("store", 5)))
    assert r.consensus_value == "park"
    assert r.latest_observation_value == "store"
