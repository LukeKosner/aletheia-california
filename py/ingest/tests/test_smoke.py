import aletheia_ingest


def test_package_imports() -> None:
    import duckdb
    import httpx
    import polars
    import psycopg

    assert aletheia_ingest is not None
    assert all(m is not None for m in (duckdb, httpx, polars, psycopg))
