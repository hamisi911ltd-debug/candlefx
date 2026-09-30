"""SQL literal quoting for use with `wrangler d1 execute`, which has no
parameter-binding flag (see app.db_d1). Every value that reaches SQL text must go
through `sql_quote` - never interpolate a raw value into a query string directly.
"""
from datetime import datetime


def sql_quote(value) -> str:
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return "1" if value else "0"
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, datetime):
        value = value.isoformat()
    # Strings (and anything else): standard SQL single-quote escaping.
    escaped = str(value).replace("'", "''")
    return f"'{escaped}'"
