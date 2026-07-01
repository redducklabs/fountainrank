"""Real-osmium check for the normalizer (run by .github/workflows/osm-normalizer-check.yml).

Runs ``osmium export -u type_id -f geojson`` on a committed OPL sample and asserts the normalizer
decodes REAL osmium output (spec §9 pre-merge proof). Deliberately NOT a ``test_*`` module, so
pytest never collects it and it never triggers conftest's DB-backed autouse fixtures — it needs
only python3 + osmium-tool (no DB, no third-party deps).

The committed OPL yields a node, an open way, a way-area (closed way -> ``a<even>``), and a
multipolygon relation-area (``a<odd>``) on real ``osmium export`` output, so this check proves BOTH
area-id parities decode, alongside node/way ids and dedup.
"""

from __future__ import annotations

import json
import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))  # backend/ on path for `import app`

from app.imports.osmium_geojson import osmium_geojson_to_import_geojson  # noqa: E402

OPL = Path(__file__).parent / "fixtures" / "osmium_source.opl"
CANON = re.compile(r"^(node|way|relation)/\d+$")


def main() -> int:
    with tempfile.TemporaryDirectory() as d:
        out = Path(d) / "osmium.geojson"
        subprocess.run(
            ["osmium", "export", str(OPL), "-u", "type_id", "-f", "geojson", "-o", str(out)],
            check=True,
        )
        data = json.loads(out.read_text(encoding="utf-8"))

    gj, stats = osmium_geojson_to_import_geojson(data)
    print("real osmium stats:", stats)
    assert stats["unparseable"] == 0, f"undecoded osmium ids: {stats}"
    assert stats["nodes"] >= 1, stats
    assert stats["ways"] >= 1, stats
    assert stats["areas"] >= 1, stats  # way-area 'a<even>' decoded from real osmium output
    assert stats["relations"] >= 1, stats  # relation-area 'a<odd>' decoded from real osmium output
    ids = [f["id"] for f in gj["features"]]
    assert ids and all(CANON.match(i) for i in ids), ids
    print(f"OK: normalized {len(gj['features'])} features from real osmium export")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
