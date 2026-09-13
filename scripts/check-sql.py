"""Parse every migration and the seed with libpg_query (via pglast).

Nothing here touches a database: it only proves the SQL is valid Postgres syntax
before anyone pushes it to the live project. Exits non-zero on the first bad file.

    pip install "pglast>=8.3,<9" && python3 scripts/check-sql.py
"""

import sys
from pathlib import Path

import pglast

root = Path(__file__).resolve().parent.parent
files = sorted((root / "supabase" / "migrations").glob("*.sql")) + [root / "supabase" / "seed.sql"]

failed = 0
for path in files:
    try:
        statements = pglast.parse_sql(path.read_text())
        print(f"ok    {path.relative_to(root)} ({len(statements)} statements)")
    except pglast.parser.ParseError as error:
        failed += 1
        print(f"FAIL  {path.relative_to(root)}: {error}")

print(f"\n{len(files) - failed} of {len(files)} SQL files parse")
sys.exit(1 if failed else 0)
