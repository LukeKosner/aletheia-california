"""Minimal Socrata (SODA 2.0) client: page through a dataset as CSV, every column a string."""

from __future__ import annotations

import io
import os
import time

import httpx
import polars as pl

PAGE = 50_000


def _client() -> httpx.Client:
    headers = {"Accept": "text/csv"}
    token = os.environ.get("SOCRATA_APP_TOKEN")
    if token:
        headers["X-App-Token"] = token
    return httpx.Client(timeout=httpx.Timeout(300.0), headers=headers, follow_redirects=True)


def _get(client: httpx.Client, url: str, params: dict[str, str]) -> httpx.Response:
    for attempt in range(5):
        try:
            r = client.get(url, params=params)
            if r.status_code < 500 and r.status_code != 429:
                r.raise_for_status()
                return r
        except httpx.TransportError:
            if attempt == 4:
                raise
        time.sleep(2**attempt)
    r.raise_for_status()
    return r


def fetch(
    domain: str,
    dataset: str,
    select: list[str],
    where: str | None = None,
    log: callable = print,
) -> pl.DataFrame:
    """Download every row of `dataset` with the given columns, as strings."""
    url = f"https://{domain}/resource/{dataset}.csv"
    frames: list[pl.DataFrame] = []
    offset = 0
    with _client() as client:
        while True:
            params = {"$select": ",".join(select), "$order": ":id", "$limit": str(PAGE), "$offset": str(offset)}
            if where:
                params["$where"] = where
            r = _get(client, url, params)
            page = pl.read_csv(io.BytesIO(r.content), infer_schema=False)
            # Socrata omits columns that are null on every row of a page; restore them.
            page = page.with_columns(pl.lit(None, dtype=pl.String).alias(c) for c in select if c not in page.columns)
            frames.append(page.select(select))
            offset += page.height
            log(f"  {domain}/{dataset}: {offset:,} rows")
            if page.height < PAGE:
                break
    return pl.concat(frames) if frames else pl.DataFrame({c: [] for c in select}, schema={c: pl.String for c in select})


def query(domain: str, dataset: str, params: dict[str, str]) -> pl.DataFrame:
    """Run one SoQL query (for server-side aggregates) and return the CSV result."""
    url = f"https://{domain}/resource/{dataset}.csv"
    with _client() as client:
        r = _get(client, url, {"$limit": "1000000", **params})
    return pl.read_csv(io.BytesIO(r.content), infer_schema=False)
