"""Turn staged CAL-ACCESS text tables into rows for entity, entity_alias, filing, money_edge, lobby_activity.

Everything happens in DuckDB. Output tables are prefixed `out_`. Every output row carries a deterministic id
(an MD5-based, version-3-style UUID of a stable natural key), so reruns produce the same ids.

Rules from AGENTS.md / the task:
- Only the latest amendment of each filing is kept.
- Committees (and every other CAL-ACCESS filer) are one entity each, keyed `calaccess:filer:<FILER_ID>`.
  Filers are only ever matched by id (FILER_ID, CMTE_ID, CAND_ID, BAL_ID, EMPLR_ID), never by name.
- Every distinct raw name (donor, payee, lender, lobbying client, IE target) without a filer id becomes one
  temporary entity keyed `calaccess:raw:<hash>` plus one entity_alias row. Entity resolution happens later.
"""

from __future__ import annotations

import duckdb

SOURCE = "calaccess"
FILING_URL = "https://cal-access.sos.ca.gov/PDFGen/pdfgen.prg?filingid={filing_id}&amendid={amend_id}"

# Bill numbers in lobbying activity text, per the task spec, with word boundaries so "SB 12" inside "SB 1234"
# or "MASB 3" is not misread.
BILL_RE = r"(?i)\b(ACA|SCA|AJR|SJR|ACR|SCR|AB|SB)\s*-?\s*(\d{1,4})\b"

def bills_sql(col: str) -> str:
    """DuckDB expression: sorted distinct bill numbers in `col`, normalized to e.g. 'AB 1751'."""
    return f"""coalesce(list_sort(list_distinct(list_transform(
        regexp_extract_all(coalesce({col}, ''), '{BILL_RE}'),
        lambda b: upper(regexp_extract(b, '^[A-Za-z]+')) || ' '
             || CAST(CAST(regexp_extract(b, '(\\d+)$') AS INTEGER) AS VARCHAR)))), [])"""


MACROS = r"""
CREATE OR REPLACE MACRO uuid_hex(h) AS
    substr(h, 1, 8) || '-' || substr(h, 9, 4) || '-3' || substr(h, 14, 3) || '-'
    || substr('89ab', (('0x' || substr(h, 17, 1))::INTEGER % 4) + 1, 1) || substr(h, 18, 3) || '-' || substr(h, 21, 12);
CREATE OR REPLACE MACRO det_uuid(k) AS uuid_hex(md5(k));
CREATE OR REPLACE MACRO ts(x) AS coalesce(
    try_strptime(trim(x), '%m/%d/%Y %I:%M:%S %p'),
    try_strptime(trim(x), '%m/%d/%Y')
);
CREATE OR REPLACE MACRO dt(x) AS CAST(ts(x) AS DATE);
CREATE OR REPLACE MACRO amt(x) AS TRY_CAST(replace(replace(trim(x), ',', ''), '$', '') AS DECIMAL(14, 2));
CREATE OR REPLACE MACRO clean(x) AS nullif(regexp_replace(upper(trim(x)), '\s+', ' ', 'g'), '');
CREATE OR REPLACE MACRO person_name(f, l, t, s) AS nullif(trim(concat_ws(' ',
    nullif(trim(t), ''), nullif(trim(f), ''), nullif(trim(l), ''), nullif(trim(s), ''))), '');
CREATE OR REPLACE MACRO raw_key(cd, l, f, t, s, city, st, zip) AS 'calaccess:raw:' || md5(concat_ws('|',
    coalesce(clean(cd), ''), coalesce(clean(l), ''), coalesce(clean(f), ''), coalesce(clean(t), ''),
    coalesce(clean(s), ''), coalesce(clean(city), ''), coalesce(clean(st), ''),
    coalesce(left(regexp_replace(coalesce(zip, ''), '[^0-9]', '', 'g'), 5), '')));
CREATE OR REPLACE MACRO raw_kind(cd) AS CASE
    WHEN upper(trim(cd)) = 'IND' THEN 'person'
    WHEN upper(trim(cd)) IN ('COM', 'SCC', 'PTY', 'CTL', 'RCP', 'BMC', 'CAO', 'MDI') THEN 'committee'
    ELSE 'org' END;
CREATE OR REPLACE MACRO filer_key(id) AS 'calaccess:filer:' || id;
"""


def run(con: duckdb.DuckDBPyConnection, zip_sha256: str, since: str | None = None) -> dict[str, int]:
    """Build out_* tables. `since` (YYYY-MM-DD) keeps only filings whose period ends (or that were filed) on or
    after that date; None keeps everything."""
    con.execute("SET preserve_insertion_order = false")
    con.execute(MACROS)
    since_sql = f"DATE '{since}'" if since else "NULL::DATE"

    # ---------- filer ids ----------
    # Column names are unique (xr_*) so a macro argument such as `filer_id` cannot be captured by the subquery.
    # Legacy ids (e.g. "C00123", "L25430") map to current numeric FILER_IDs through FILER_XREF_CD.
    con.execute(
        """
        CREATE OR REPLACE TABLE filer_xref AS
        SELECT DISTINCT ON (upper(trim(xref_id))) upper(trim(xref_id)) AS xr_legacy_id, trim(filer_id) AS xr_filer_id
        FROM filer_xref_cd
        WHERE xref_id IS NOT NULL AND regexp_full_match(trim(filer_id), '\\d+')
        ORDER BY upper(trim(xref_id)), ts(effect_dt) DESC NULLS LAST
        """
    )
    con.execute(
        """
        CREATE OR REPLACE MACRO norm_fid(x) AS CASE
            WHEN x IS NULL OR trim(x) = '' THEN NULL
            WHEN regexp_full_match(trim(x), '\\d+') THEN CAST(CAST(trim(x) AS HUGEINT) AS VARCHAR)
            ELSE (SELECT xr_filer_id FROM filer_xref WHERE xr_legacy_id = upper(trim(x)))
        END
        """
    )

    # ---------- latest amendment of every filing ----------
    con.execute(
        """
        CREATE OR REPLACE TABLE filing_amends AS
        SELECT filing_id, TRY_CAST(amend_id AS INTEGER) AS amend_id FROM cvr_campaign_disclosure_cd
        UNION ALL SELECT filing_id, TRY_CAST(amend_id AS INTEGER) FROM cvr_lobby_disclosure_cd
        UNION ALL SELECT filing_id, TRY_CAST(filing_sequence AS INTEGER) FROM filer_filings_cd
        UNION ALL SELECT DISTINCT filing_id, TRY_CAST(amend_id AS INTEGER) FROM rcpt_cd
        UNION ALL SELECT DISTINCT filing_id, TRY_CAST(amend_id AS INTEGER) FROM expn_cd
        UNION ALL SELECT DISTINCT filing_id, TRY_CAST(amend_id AS INTEGER) FROM s497_cd
        UNION ALL SELECT DISTINCT filing_id, TRY_CAST(amend_id AS INTEGER) FROM s496_cd
        UNION ALL SELECT DISTINCT filing_id, TRY_CAST(amend_id AS INTEGER) FROM loan_cd
        UNION ALL SELECT DISTINCT filing_id, TRY_CAST(amend_id AS INTEGER) FROM lpay_cd;
        CREATE OR REPLACE TABLE latest AS
        SELECT trim(filing_id) AS filing_id, max(amend_id) AS amend_id
        FROM filing_amends WHERE filing_id IS NOT NULL AND amend_id IS NOT NULL
        GROUP BY 1;
        """
    )

    # Cover of the latest version (campaign or lobbying), with filer, form and period.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE cover AS
        WITH c AS (
            SELECT trim(filing_id) AS filing_id, TRY_CAST(amend_id AS INTEGER) AS amend_id, form_type, filer_id,
                   filer_naml, filer_namf, filer_namt, filer_nams, entity_cd, rpt_date, from_date, thru_date,
                   cand_naml, cand_namf, cand_namt, cand_nams, cand_id, bal_name, bal_num, bal_juris, bal_id,
                   office_cd, dist_no, juris_cd, sup_opp_cd, NULL AS lby_actvty, NULL AS firm_id, NULL AS firm_name,
                   'campaign' AS kind, _line
            FROM cvr_campaign_disclosure_cd
            UNION ALL
            SELECT trim(filing_id), TRY_CAST(amend_id AS INTEGER), form_type, filer_id, filer_naml, filer_namf,
                   filer_namt, filer_nams, entity_cd, rpt_date, from_date, thru_date, NULL, NULL, NULL, NULL, NULL,
                   NULL, NULL, NULL, NULL, NULL, NULL, NULL, NULL, lby_actvty, firm_id, firm_name, 'lobby', _line
            FROM cvr_lobby_disclosure_cd
        )
        SELECT DISTINCT ON (c.filing_id) c.*
        FROM c JOIN latest l USING (filing_id, amend_id)
        ORDER BY c.filing_id, c._line DESC
        """
    )

    # filer_filings row of the latest version: filing date and fallback filer/period.
    con.execute(
        """
        CREATE OR REPLACE TABLE ff_latest AS
        SELECT DISTINCT ON (trim(f.filing_id)) trim(f.filing_id) AS filing_id, f.filer_id, f.form_id,
               ts(f.filing_date) AS filed_at, dt(f.rpt_start) AS rpt_start, dt(f.rpt_end) AS rpt_end
        FROM filer_filings_cd f JOIN latest l
          ON trim(f.filing_id) = l.filing_id AND TRY_CAST(f.filing_sequence AS INTEGER) = l.amend_id
        ORDER BY trim(f.filing_id), f._line DESC
        """
    )

    # Every filing version we keep: latest amendment, with a known filer.
    con.execute(
        f"""
        CREATE OR REPLACE TABLE filings AS
        SELECT l.filing_id, l.amend_id,
               coalesce(c.form_type, ff.form_id) AS form,
               coalesce(norm_fid(c.filer_id), norm_fid(ff.filer_id)) AS filer_id,
               coalesce(ff.filed_at, ts(c.rpt_date)) AS filed_at,
               coalesce(dt(c.from_date), ff.rpt_start) AS period_start,
               coalesce(dt(c.thru_date), ff.rpt_end) AS period_end,
               c.kind AS cover_kind
        FROM latest l
        LEFT JOIN cover c USING (filing_id)
        LEFT JOIN ff_latest ff USING (filing_id)
        WHERE {since_sql} IS NULL
           OR coalesce(dt(c.thru_date), ff.rpt_end, CAST(coalesce(ff.filed_at, ts(c.rpt_date)) AS DATE)) >= {since_sql}
        """
    )

    # ---------- itemized rows, latest amendment only ----------
    def latest_rows(table: str) -> str:
        return f"""
            SELECT t.*, row_number() OVER (
                PARTITION BY t.filing_id, t.form_type, t.line_item ORDER BY t._line) AS dup_no
            FROM {table} t
            JOIN filings f ON trim(t.filing_id) = f.filing_id AND TRY_CAST(t.amend_id AS INTEGER) = f.amend_id
        """

    # Raw edges: one row per itemized record with from/to keys. Temporary entities are collected separately.
    con.execute("CREATE OR REPLACE TABLE raw_party (key VARCHAR, kind VARCHAR, name VARCHAR, attrs JSON, row_ref VARCHAR)")
    con.execute(
        """
        CREATE OR REPLACE TABLE edges (
            id VARCHAR, from_key VARCHAR, to_key VARCHAR, amount DECIMAL(14,2), date DATE, kind VARCHAR,
            filing_id VARCHAR, amend_id INTEGER, schedule VARCHAR, line_item VARCHAR, src_table VARCHAR,
            memo BOOLEAN
        )
        """
    )

    # RCPT_CD: receipts. A, C, F496P3, F401A -> contribution; A-1 -> transfer. I (misc. increases to cash) and
    # E530 (issue advocacy) are not contributions and are counted in the exclusion log instead.
    con.execute(f"CREATE OR REPLACE TEMP VIEW rcpt AS {latest_rows('rcpt_cd')}")
    con.execute(
        """
        INSERT INTO raw_party
        SELECT raw_key(entity_cd, ctrib_naml, ctrib_namf, ctrib_namt, ctrib_nams, ctrib_city, ctrib_st, ctrib_zip4) AS key,
               raw_kind(entity_cd),
               CASE WHEN upper(trim(entity_cd)) = 'IND' THEN person_name(ctrib_namf, ctrib_naml, ctrib_namt, ctrib_nams)
                    ELSE coalesce(person_name(ctrib_namf, ctrib_naml, NULL, NULL), '(no name given)') END,
               json_object('entity_cd', entity_cd, 'city', ctrib_city, 'state', ctrib_st, 'zip', ctrib_zip4,
                           'employer', ctrib_emp, 'occupation', ctrib_occ),
               'RCPT_CD:' || filing_id || ':' || amend_id || ':' || form_type || ':' || line_item AS row_ref
        FROM rcpt WHERE norm_fid(cmte_id) IS NULL
        QUALIFY row_number() OVER (PARTITION BY key ORDER BY row_ref) = 1;
        INSERT INTO edges
        SELECT det_uuid('calaccess:RCPT_CD:' || r.filing_id || ':' || r.form_type || ':' || r.line_item || ':' || r.dup_no),
               coalesce(filer_key(norm_fid(r.cmte_id)),
                        raw_key(entity_cd, ctrib_naml, ctrib_namf, ctrib_namt, ctrib_nams, ctrib_city, ctrib_st, ctrib_zip4)),
               filer_key(f.filer_id),
               amt(r.amount), dt(r.rcpt_date),
               CASE WHEN r.form_type IN ('A', 'C', 'F496P3', 'F401A', 'F900') THEN 'contribution'
                    WHEN r.form_type = 'A-1' THEN 'transfer' END,
               f.filing_id, f.amend_id, r.form_type, r.line_item, 'RCPT_CD', coalesce(upper(trim(r.memo_code)) = 'X', false)
        FROM rcpt r JOIN filings f ON trim(r.filing_id) = f.filing_id;
        """
    )

    # S497_CD: late contributions. P1 received (donor -> filer), P2 made (filer -> recipient).
    con.execute(f"CREATE OR REPLACE TEMP VIEW s497 AS {latest_rows('s497_cd')}")
    con.execute(
        """
        INSERT INTO raw_party
        SELECT raw_key(entity_cd, enty_naml, enty_namf, enty_namt, enty_nams, enty_city, enty_st, enty_zip4) AS key,
               raw_kind(entity_cd),
               coalesce(person_name(enty_namf, enty_naml, CASE WHEN upper(trim(entity_cd)) = 'IND' THEN enty_namt END,
                                    CASE WHEN upper(trim(entity_cd)) = 'IND' THEN enty_nams END), '(no name given)'),
               json_object('entity_cd', entity_cd, 'city', enty_city, 'state', enty_st, 'zip', enty_zip4,
                           'employer', ctrib_emp, 'occupation', ctrib_occ),
               'S497_CD:' || filing_id || ':' || amend_id || ':' || form_type || ':' || line_item AS row_ref
        FROM s497 WHERE norm_fid(cmte_id) IS NULL
        QUALIFY row_number() OVER (PARTITION BY key ORDER BY row_ref) = 1;
        INSERT INTO edges
        WITH x AS (
            SELECT s.*, f.filer_id AS f_filer, f.amend_id AS f_amend,
                   coalesce(filer_key(norm_fid(s.cmte_id)),
                            raw_key(entity_cd, enty_naml, enty_namf, enty_namt, enty_nams, enty_city, enty_st, enty_zip4)) AS party
            FROM s497 s JOIN filings f ON trim(s.filing_id) = f.filing_id
        )
        SELECT det_uuid('calaccess:S497_CD:' || filing_id || ':' || form_type || ':' || line_item || ':' || dup_no),
               CASE WHEN form_type = 'F497P2' THEN filer_key(f_filer) ELSE party END,
               CASE WHEN form_type = 'F497P2' THEN party ELSE filer_key(f_filer) END,
               amt(amount), dt(ctrib_date),
               CASE WHEN form_type IN ('F497P1', 'F497P2') THEN 'contribution' END,
               trim(filing_id), f_amend, form_type, line_item, 'S497_CD', coalesce(upper(trim(memo_code)) = 'X', false)
        FROM x;
        """
    )

    # EXPN_CD: expenditures. Independent expenditures go to the supported/opposed candidate or measure.
    con.execute(f"CREATE OR REPLACE TEMP VIEW expn AS {latest_rows('expn_cd')}")
    con.execute(
        """
        CREATE OR REPLACE TEMP VIEW expn_k AS
        SELECT e.*, f.filer_id AS f_filer, f.amend_id AS f_amend,
            upper(trim(e.expn_code)) AS code, upper(trim(e.sup_opp_cd)) AS so,
            (upper(trim(e.expn_code)) = 'IND' OR e.form_type = 'F465P3') AS is_ie,
            raw_key(e.entity_cd, e.payee_naml, e.payee_namf, e.payee_namt, e.payee_nams, e.payee_city, e.payee_st,
                    e.payee_zip4) AS payee_key,
            CASE WHEN coalesce(trim(e.cand_naml), '') <> '' THEN
                     raw_key('CAND', e.cand_naml, e.cand_namf, e.cand_namt, e.cand_nams, e.office_cd, e.juris_cd, e.dist_no)
                 WHEN coalesce(trim(e.bal_name), '') <> '' OR coalesce(trim(e.bal_num), '') <> '' THEN
                     raw_key('BAL', e.bal_name, e.bal_num, e.bal_juris, NULL, NULL, NULL, NULL)
            END AS target_key,
            filer_key(norm_fid(e.cmte_id)) AS cmte_key
        FROM expn e JOIN filings f ON trim(e.filing_id) = f.filing_id
        """
    )
    con.execute(
        """
        INSERT INTO raw_party
        SELECT payee_key AS key, raw_kind(entity_cd),
               coalesce(person_name(payee_namf, payee_naml, CASE WHEN upper(trim(entity_cd)) = 'IND' THEN payee_namt END,
                                    CASE WHEN upper(trim(entity_cd)) = 'IND' THEN payee_nams END), '(no name given)'),
               json_object('entity_cd', entity_cd, 'city', payee_city, 'state', payee_st, 'zip', payee_zip4),
               'EXPN_CD:' || filing_id || ':' || amend_id || ':' || form_type || ':' || line_item AS row_ref
        FROM expn_k
        QUALIFY row_number() OVER (PARTITION BY key ORDER BY row_ref) = 1;
        INSERT INTO raw_party
        SELECT target_key AS key,
               CASE WHEN coalesce(trim(cand_naml), '') <> '' THEN 'candidate' ELSE 'measure' END,
               CASE WHEN coalesce(trim(cand_naml), '') <> '' THEN person_name(cand_namf, cand_naml, cand_namt, cand_nams)
                    ELSE trim(concat_ws(' ', nullif(trim(bal_num), ''), nullif(trim(bal_name), ''))) END,
               json_object('office_cd', office_cd, 'juris_cd', juris_cd, 'dist_no', dist_no, 'bal_num', bal_num,
                           'bal_juris', bal_juris),
               'EXPN_CD:' || filing_id || ':' || amend_id || ':' || form_type || ':' || line_item AS row_ref
        FROM expn_k WHERE target_key IS NOT NULL
        QUALIFY row_number() OVER (PARTITION BY key ORDER BY row_ref) = 1;
        INSERT INTO edges
        SELECT det_uuid('calaccess:EXPN_CD:' || filing_id || ':' || form_type || ':' || line_item || ':' || dup_no),
               filer_key(f_filer),
               CASE WHEN is_ie AND so IN ('S', 'O') THEN coalesce(target_key, cmte_key, payee_key)
                    ELSE coalesce(cmte_key, payee_key) END,
               amt(amount), dt(expn_date),
               CASE WHEN is_ie AND so = 'S' THEN 'ie_support'
                    WHEN is_ie AND so = 'O' THEN 'ie_oppose'
                    WHEN code = 'TSF' THEN 'transfer'
                    WHEN code IN ('CTB', 'IKD') OR form_type = 'D' THEN 'contribution'
                    ELSE 'expenditure' END,
               trim(filing_id), f_amend, form_type, line_item, 'EXPN_CD', coalesce(upper(trim(memo_code)) = 'X', false)
        FROM expn_k;
        """
    )

    # S496_CD: late independent expenditures. The candidate or measure is on the Form 496 cover.
    con.execute(f"CREATE OR REPLACE TEMP VIEW s496 AS {latest_rows('s496_cd')}")
    con.execute(
        """
        CREATE OR REPLACE TEMP VIEW s496_k AS
        SELECT s.*, f.filer_id AS f_filer, f.amend_id AS f_amend, upper(trim(c.sup_opp_cd)) AS so,
            CASE WHEN norm_fid(c.cand_id) IS NOT NULL THEN filer_key(norm_fid(c.cand_id))
                 WHEN norm_fid(c.bal_id) IS NOT NULL THEN filer_key(norm_fid(c.bal_id))
                 WHEN coalesce(trim(c.cand_naml), '') <> '' THEN
                     raw_key('CAND', c.cand_naml, c.cand_namf, c.cand_namt, c.cand_nams, c.office_cd, c.juris_cd, c.dist_no)
                 WHEN coalesce(trim(c.bal_name), '') <> '' OR coalesce(trim(c.bal_num), '') <> '' THEN
                     raw_key('BAL', c.bal_name, c.bal_num, c.bal_juris, NULL, NULL, NULL, NULL)
            END AS target_key,
            c.cand_naml, c.cand_namf, c.cand_namt, c.cand_nams, c.bal_name, c.bal_num, c.bal_juris, c.office_cd,
            c.juris_cd, c.dist_no
        FROM s496 s JOIN filings f ON trim(s.filing_id) = f.filing_id
        LEFT JOIN cover c ON c.filing_id = f.filing_id
        """
    )
    con.execute(
        """
        INSERT INTO raw_party
        SELECT target_key AS key,
               CASE WHEN coalesce(trim(cand_naml), '') <> '' THEN 'candidate' ELSE 'measure' END,
               CASE WHEN coalesce(trim(cand_naml), '') <> '' THEN person_name(cand_namf, cand_naml, cand_namt, cand_nams)
                    ELSE trim(concat_ws(' ', nullif(trim(bal_num), ''), nullif(trim(bal_name), ''))) END,
               json_object('office_cd', office_cd, 'juris_cd', juris_cd, 'dist_no', dist_no, 'bal_num', bal_num,
                           'bal_juris', bal_juris),
               'S496_CD:' || filing_id || ':' || amend_id || ':' || form_type || ':' || line_item AS row_ref
        FROM s496_k WHERE target_key LIKE 'calaccess:raw:%'
        QUALIFY row_number() OVER (PARTITION BY key ORDER BY row_ref) = 1;
        INSERT INTO edges
        SELECT det_uuid('calaccess:S496_CD:' || filing_id || ':' || form_type || ':' || line_item || ':' || dup_no),
               filer_key(f_filer), target_key, amt(amount), dt(exp_date),
               CASE so WHEN 'S' THEN 'ie_support' WHEN 'O' THEN 'ie_oppose' END,
               trim(filing_id), f_amend, form_type, line_item, 'S496_CD', coalesce(upper(trim(memo_code)) = 'X', false)
        FROM s496_k;
        """
    )

    # LOAN_CD: B1 loans received (lender -> filer), H1/H loans made (filer -> borrower). B2 (guarantors) and
    # B3/H2/H3 (repayments, forgiveness) are not new money and go to the exclusion log.
    con.execute(f"CREATE OR REPLACE TEMP VIEW loan AS {latest_rows('loan_cd')}")
    con.execute(
        """
        INSERT INTO raw_party
        SELECT raw_key(entity_cd, lndr_naml, lndr_namf, lndr_namt, lndr_nams, loan_city, loan_st, loan_zip4) AS key,
               raw_kind(entity_cd),
               coalesce(person_name(lndr_namf, lndr_naml, CASE WHEN upper(trim(entity_cd)) = 'IND' THEN lndr_namt END,
                                    CASE WHEN upper(trim(entity_cd)) = 'IND' THEN lndr_nams END), '(no name given)'),
               json_object('entity_cd', entity_cd, 'city', loan_city, 'state', loan_st, 'zip', loan_zip4,
                           'employer', loan_emp, 'occupation', loan_occ),
               'LOAN_CD:' || filing_id || ':' || amend_id || ':' || form_type || ':' || line_item AS row_ref
        FROM loan WHERE norm_fid(cmte_id) IS NULL
        QUALIFY row_number() OVER (PARTITION BY key ORDER BY row_ref) = 1;
        INSERT INTO edges
        WITH x AS (
            SELECT l.*, f.filer_id AS f_filer, f.amend_id AS f_amend,
                   coalesce(filer_key(norm_fid(l.cmte_id)),
                            raw_key(entity_cd, lndr_naml, lndr_namf, lndr_namt, lndr_nams, loan_city, loan_st, loan_zip4)) AS party
            FROM loan l JOIN filings f ON trim(l.filing_id) = f.filing_id
        )
        SELECT det_uuid('calaccess:LOAN_CD:' || filing_id || ':' || form_type || ':' || line_item || ':' || dup_no),
               CASE WHEN form_type IN ('H', 'H1') THEN filer_key(f_filer) ELSE party END,
               CASE WHEN form_type IN ('H', 'H1') THEN party ELSE filer_key(f_filer) END,
               amt(loan_amt1), dt(loan_date1),
               CASE WHEN form_type IN ('B1', 'H', 'H1') THEN 'loan' END,
               trim(filing_id), f_amend, form_type, line_item, 'LOAN_CD', coalesce(upper(trim(memo_code)) = 'X', false)
        FROM x;
        """
    )

    # ---------- lobbying ----------
    # Text memos attached to lobbying filings (long activity descriptions), by filing and memo ref.
    con.execute(
        """
        CREATE OR REPLACE TABLE lobby_memo AS
        SELECT trim(m.filing_id) AS filing_id, upper(trim(m.form_type)) AS form_type, trim(m.ref_no) AS ref_no,
               string_agg(m.text4000, ' ' ORDER BY m._line) AS text
        FROM text_memo_cd m JOIN filings f
          ON trim(m.filing_id) = f.filing_id AND TRY_CAST(m.amend_id AS INTEGER) = f.amend_id
        WHERE f.cover_kind = 'lobby'
        GROUP BY ALL
        """
    )
    con.execute(f"CREATE OR REPLACE TEMP VIEW lpay AS {latest_rows('lpay_cd')}")
    con.execute(
        """
        CREATE OR REPLACE TEMP VIEW lpay_k AS
        SELECT p.*, f.filer_id AS f_filer, f.amend_id AS f_amend, f.period_start, f.period_end,
            coalesce(filer_key(norm_fid(p.emplr_id)),
                     raw_key(p.entity_cd, p.emplr_naml, p.emplr_namf, p.emplr_namt, p.emplr_nams, p.emplr_city,
                             p.emplr_st, p.emplr_zip4)) AS party,
            concat_ws(' ', p.lby_actvty, m.text) AS activity
        FROM lpay p JOIN filings f ON trim(p.filing_id) = f.filing_id
        LEFT JOIN lobby_memo m ON m.filing_id = f.filing_id AND m.ref_no = trim(p.memo_refno)
        """
    )
    con.execute(
        """
        INSERT INTO raw_party
        SELECT party AS key, CASE WHEN form_type = 'F635P3B' THEN 'lobby_firm' ELSE 'org' END,
               coalesce(person_name(emplr_namf, emplr_naml, NULL, NULL), '(no name given)'),
               json_object('entity_cd', entity_cd, 'city', emplr_city, 'state', emplr_st, 'zip', emplr_zip4),
               'LPAY_CD:' || filing_id || ':' || amend_id || ':' || form_type || ':' || line_item AS row_ref
        FROM lpay_k WHERE party LIKE 'calaccess:raw:%'
        QUALIFY row_number() OVER (PARTITION BY key ORDER BY row_ref) = 1;
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE lobby AS
        -- Form 625 Part 2: payments a firm received from an employer. Form 635 Part 3B: payments an employer
        -- made to a firm.
        SELECT det_uuid('calaccess:LPAY_CD:' || filing_id || ':' || form_type || ':' || line_item || ':' || dup_no) AS id,
               CASE WHEN form_type = 'F625P2' THEN party ELSE filer_key(f_filer) END AS employer_key,
               CASE WHEN form_type = 'F625P2' THEN filer_key(f_filer) ELSE party END AS firm_key,
               period_start, period_end, amt(per_total) AS amount, trim(filing_id) AS filing_id, f_amend AS amend_id,
               activity, 'LPAY_CD:' || form_type AS src
        FROM lpay_k WHERE form_type IN ('F625P2', 'F635P3B')
        UNION ALL
        -- Form 635/645 cover: the employer's own description of what it lobbied on. Amount is on the summary
        -- page, not the cover, so it is left empty here.
        SELECT det_uuid('calaccess:CVR_LOBBY:' || f.filing_id), filer_key(f.filer_id), NULL, f.period_start,
               f.period_end, NULL, f.filing_id, f.amend_id,
               concat_ws(' ', c.lby_actvty, m.text), 'CVR_LOBBY_DISCLOSURE_CD:' || c.form_type
        FROM filings f JOIN cover c USING (filing_id)
        LEFT JOIN (SELECT filing_id, string_agg(text, ' ') AS text FROM lobby_memo
                   WHERE form_type IN ('F635', 'F645') GROUP BY 1) m USING (filing_id)
        WHERE c.kind = 'lobby' AND c.form_type IN ('F635', 'F645')
        """
    )
    con.execute(
        f"""
        CREATE OR REPLACE TABLE out_lobby_activity AS
        SELECT id, employer_key, firm_key, period_start, period_end, amount, filing_id, amend_id, src,
               {bills_sql('activity')} AS bills
        FROM lobby
        WHERE employer_key IS NOT NULL
        """
    )

    # ---------- filings ----------
    con.execute(
        f"""
        CREATE OR REPLACE TABLE out_filing AS
        WITH used AS (
            SELECT DISTINCT filing_id FROM edges WHERE kind IS NOT NULL AND NOT memo
            UNION SELECT DISTINCT filing_id FROM out_lobby_activity
        )
        SELECT det_uuid('calaccess:filing:' || f.filing_id || ':' || f.amend_id) AS id,
               '{SOURCE}' AS source, f.filing_id, f.amend_id AS amendment_no, f.form, f.filed_at, f.period_start,
               f.period_end,
               replace(replace('{FILING_URL}', '{{filing_id}}', f.filing_id), '{{amend_id}}', CAST(f.amend_id AS VARCHAR)) AS url,
               '{zip_sha256}' AS raw_sha256, f.filer_id
        FROM filings f JOIN used USING (filing_id)
        """
    )

    # ---------- money edges ----------
    # Memo rows repeat amounts already reported elsewhere on the same filing, and rows with no amount, no
    # mapped kind or no counterparty cannot be edges; all are counted in out_exclusions rather than dropped
    # silently.
    con.execute(
        """
        CREATE OR REPLACE TABLE out_exclusions AS
        SELECT src_table, schedule,
               CASE WHEN memo THEN 'memo_item'
                    WHEN kind IS NULL THEN 'not_a_money_edge_schedule'
                    WHEN amount IS NULL THEN 'unparseable_amount'
                    WHEN from_key IS NULL OR to_key IS NULL THEN 'missing_party'
               END AS reason,
               count(*) AS n, sum(amount) AS total
        FROM edges
        WHERE memo OR kind IS NULL OR amount IS NULL OR from_key IS NULL OR to_key IS NULL
        GROUP BY ALL
        UNION ALL
        SELECT 'lobby_activity', src, 'missing_employer', count(*), sum(amount)
        FROM lobby WHERE employer_key IS NULL GROUP BY ALL
        """
    )
    con.execute(
        """
        CREATE OR REPLACE VIEW out_money_edge AS
        SELECT id, from_key, to_key, amount, date, kind, filing_id, amend_id, schedule, line_item, src_table
        FROM edges
        WHERE NOT memo AND kind IS NOT NULL AND amount IS NOT NULL AND from_key IS NOT NULL AND to_key IS NOT NULL
        """
    )

    # ---------- entities ----------
    con.execute(
        """
        CREATE OR REPLACE TABLE filer_name AS
        SELECT DISTINCT ON (trim(filer_id)) trim(filer_id) AS filer_id,
               person_name(namf, naml, namt, nams) AS name, upper(trim(filer_type)) AS filer_type,
               upper(trim(status)) AS status
        FROM filername_cd
        WHERE regexp_full_match(trim(filer_id), '\\d+')
        ORDER BY trim(filer_id), ts(effect_dt) DESC NULLS LAST, _line DESC
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE out_entity AS
        WITH keys AS (
            SELECT from_key AS key FROM out_money_edge UNION SELECT to_key FROM out_money_edge
            UNION SELECT employer_key FROM out_lobby_activity UNION SELECT firm_key FROM out_lobby_activity
        ),
        filer_keys AS (
            SELECT key, substr(key, length('calaccess:filer:') + 1) AS filer_id
            FROM keys WHERE key LIKE 'calaccess:filer:%'
        ),
        cover_name AS (
            SELECT DISTINCT ON (norm_fid(filer_id)) norm_fid(filer_id) AS filer_id,
                   person_name(filer_namf, filer_naml, filer_namt, filer_nams) AS name
            FROM cover WHERE norm_fid(filer_id) IS NOT NULL
            ORDER BY norm_fid(filer_id), ts(rpt_date) DESC NULLS LAST
        ),
        filers AS (
            SELECT k.key, coalesce(n.name, c.name, 'CAL-ACCESS filer ' || k.filer_id) AS name,
                   CASE
                       WHEN n.filer_type LIKE 'RECIPIENT COMMITTEE%' OR n.filer_type LIKE '%COMMITTEE%' THEN 'committee'
                       WHEN n.filer_type LIKE 'CANDIDATE%' THEN 'candidate'
                       WHEN n.filer_type = 'LOBBYING FIRM' THEN 'lobby_firm'
                       WHEN n.filer_type = 'LOBBYIST' THEN 'person'
                       WHEN n.filer_type IS NULL THEN 'committee'
                       ELSE 'org'
                   END AS kind,
                   json_object('source', 'calaccess', 'filer_id', k.filer_id, 'filer_type', n.filer_type,
                               'status', n.status) AS attrs
            FROM filer_keys k
            LEFT JOIN filer_name n USING (filer_id)
            LEFT JOIN cover_name c USING (filer_id)
        ),
        raws AS (
            SELECT DISTINCT ON (key) key, coalesce(name, '(no name given)') AS name, kind,
                   json_merge_patch(attrs::JSON, json_object('source', 'calaccess', 'temporary', true)) AS attrs,
                   row_ref
            FROM raw_party
            WHERE key IN (SELECT key FROM keys)
            ORDER BY key, row_ref
        )
        SELECT det_uuid(key) AS id, kind, name, key AS canonical_key, attrs, NULL AS row_ref FROM filers
        UNION ALL
        SELECT det_uuid(key), kind, name, key, attrs, row_ref FROM raws
        """
    )
    con.execute(
        """
        CREATE OR REPLACE TABLE out_entity_alias AS
        SELECT det_uuid(canonical_key || ':alias') AS id, canonical_key AS entity_key, name AS raw_name,
               'calaccess' AS source, row_ref AS source_row_id, 'raw' AS method
        FROM out_entity WHERE canonical_key LIKE 'calaccess:raw:%'
        """
    )

    counts = {
        t: con.execute(f"SELECT count(*) FROM {t}").fetchone()[0]
        for t in ["out_entity", "out_entity_alias", "out_filing", "out_money_edge", "out_lobby_activity"]
    }
    return counts
