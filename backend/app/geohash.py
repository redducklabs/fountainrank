"""Pure stdlib base32 geohash encoder.

Used to derive the ~1 km "area" cell key for the ``first_in_area`` contribution
bonus (``app/contributions.py``). No external geohash dependency — the standard
algorithm is short. Precision 6 ≈ a 1.2 km × 0.6 km cell, adequate for "first
fountain in an area" without colliding adjacent real fountains.
"""

from __future__ import annotations

_BASE32 = "0123456789bcdefghjkmnpqrstuvwxyz"


def geohash_encode(lat: float, lon: float, precision: int = 6) -> str:
    """Encode ``(lat, lon)`` to a base32 geohash string of ``precision`` chars.

    Standard algorithm: interleave longitude/latitude bits (longitude first),
    bisecting each range, packing every 5 bits into one base32 character.
    """
    lat_lo, lat_hi = -90.0, 90.0
    lon_lo, lon_hi = -180.0, 180.0
    out: list[str] = []
    ch = 0
    bit = 0
    even = True  # even bit -> longitude, odd bit -> latitude
    while len(out) < precision:
        if even:
            mid = (lon_lo + lon_hi) / 2
            if lon > mid:
                ch = (ch << 1) | 1
                lon_lo = mid
            else:
                ch = ch << 1
                lon_hi = mid
        else:
            mid = (lat_lo + lat_hi) / 2
            if lat > mid:
                ch = (ch << 1) | 1
                lat_lo = mid
            else:
                ch = ch << 1
                lat_hi = mid
        even = not even
        bit += 1
        if bit == 5:
            out.append(_BASE32[ch])
            ch = 0
            bit = 0
    return "".join(out)
