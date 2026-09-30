from app.sql_utils import sql_quote


def test_quotes_plain_string():
    assert sql_quote("hello") == "'hello'"


def test_escapes_single_quotes():
    assert sql_quote("O'Brien") == "'O''Brien'"


def test_escapes_sql_injection_attempt():
    malicious = "x'; DROP TABLE users; --"
    quoted = sql_quote(malicious)
    assert quoted == "'x''; DROP TABLE users; --'"
    # The quoted literal must contain no unescaped single quote that could
    # terminate the string early.
    inner = quoted[1:-1]
    assert "';" not in inner.replace("''", "")


def test_bool_and_none_and_numbers():
    assert sql_quote(True) == "1"
    assert sql_quote(False) == "0"
    assert sql_quote(None) == "NULL"
    assert sql_quote(42) == "42"
    assert sql_quote(3.14) == "3.14"
