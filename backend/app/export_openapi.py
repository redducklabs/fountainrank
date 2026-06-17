"""Dump the FastAPI OpenAPI schema (DB-free) for frontend codegen."""

import json
import sys
from pathlib import Path

from app.main import app


def main() -> None:
    schema = json.dumps(app.openapi(), indent=2)
    if len(sys.argv) > 1:
        Path(sys.argv[1]).write_text(schema + "\n", encoding="utf-8")
    else:
        sys.stdout.write(schema)


if __name__ == "__main__":
    main()
