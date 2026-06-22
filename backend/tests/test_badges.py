from types import SimpleNamespace

from app.badges import earned_badges


def _stats(**kw):
    base = dict(
        fountains_added=0,
        ratings_count=0,
        verifications_count=0,
        conditions_reported=0,
        notes_count=0,
        attributes_count=0,
    )
    base.update(kw)
    return SimpleNamespace(**base)


def _keys(badges):
    return {b.key for b in badges}


def test_no_badges_for_zero_user():
    assert earned_badges(stats=_stats(), created_rank=200, dimension_rate_counts={}) == []


def test_count_badges():
    b = earned_badges(
        stats=_stats(
            fountains_added=1,
            ratings_count=1,
            verifications_count=10,
            conditions_reported=1,
            notes_count=5,
            attributes_count=10,
        ),
        created_rank=200,
        dimension_rate_counts={},
    )
    assert _keys(b) == {
        "first_fountain",
        "hydrated_helper",
        "field_verifier",
        "fix_finder",
        "note_taker",
        "attribute_ace",
    }


def test_threshold_boundaries():
    assert "field_verifier" not in _keys(
        earned_badges(
            stats=_stats(verifications_count=9), created_rank=None, dimension_rate_counts={}
        )
    )
    assert "field_verifier" in _keys(
        earned_badges(
            stats=_stats(verifications_count=10), created_rank=None, dimension_rate_counts={}
        )
    )
    assert "note_taker" not in _keys(
        earned_badges(stats=_stats(notes_count=4), created_rank=None, dimension_rate_counts={})
    )


def test_original_100_boundary():
    assert "original_100" in _keys(
        earned_badges(stats=_stats(), created_rank=100, dimension_rate_counts={})
    )
    assert "original_100" not in _keys(
        earned_badges(stats=_stats(), created_rank=101, dimension_rate_counts={})
    )


def test_dimension_testers():
    b = earned_badges(stats=_stats(), created_rank=None, dimension_rate_counts={3: 10, 1: 9})
    assert "pressure_tester" in _keys(b)
    assert "clarity_critic" not in _keys(b)  # 9 < 10
