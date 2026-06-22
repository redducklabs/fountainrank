from app.geohash import geohash_encode

BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def test_known_vector():
    # Canonical geohash example (lat 57.64911, lon 10.40744 -> u4pruydqqvj...).
    assert geohash_encode(57.64911, 10.40744, 11) == "u4pruydqqvj"
    assert geohash_encode(57.64911, 10.40744, 6) == "u4pruy"


def test_length_and_charset():
    gh = geohash_encode(37.7749, -122.4194, 6)
    assert len(gh) == 6
    assert all(c in BASE32 for c in gh)


def test_default_precision_is_six():
    assert len(geohash_encode(0.0, 0.0)) == 6


def test_deterministic():
    assert geohash_encode(37.7749, -122.4194, 6) == geohash_encode(37.7749, -122.4194, 6)


def test_nearby_share_cell_far_differ():
    a = geohash_encode(37.7749, -122.4194, 6)
    near = geohash_encode(37.7750, -122.4195, 6)  # ~15 m away
    far = geohash_encode(40.7128, -74.0060, 6)  # NYC
    # ~15 m apart sits well inside a shared ~5 km (5-char) cell.
    assert a[:5] == near[:5]
    assert a != far
