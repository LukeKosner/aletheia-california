-- Human step after migration 0001_agent_views (drizzle-kit creates the roles and views but cannot express GRANTs or
-- role settings). Run once as the database owner, in a real terminal, then set the passwords (README.md).
-- Re-running is safe.

-- agent_ro: SELECT on the six agent views, nothing else.
alter role agent_ro with login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role agent_ro set statement_timeout = '10s';
alter role agent_ro set default_transaction_read_only = on;
alter role agent_ro set idle_in_transaction_session_timeout = '30s';
alter role agent_ro set search_path = public;
revoke all on all tables in schema public from agent_ro;
revoke create on schema public from agent_ro;
grant usage on schema public to agent_ro;
grant select on v_money, v_lobby, v_votes, v_bill_authors, v_entities, v_interests to agent_ro;

-- claim_writer: INSERT on claim, nothing else. Used only by the MCP server's cite tool, never by agent SQL.
alter role claim_writer with login nosuperuser nocreatedb nocreaterole noinherit noreplication nobypassrls;
alter role claim_writer set statement_timeout = '5s';
alter role claim_writer set search_path = public;
revoke all on all tables in schema public from claim_writer;
revoke create on schema public from claim_writer;
grant usage on schema public to claim_writer;
grant insert on claim to claim_writer;
