CREATE ROLE "agent_ro";--> statement-breakpoint
CREATE ROLE "claim_writer";--> statement-breakpoint
CREATE VIEW "public"."v_entities" AS (
  select e.id as entity_id, e.kind, e.name, e.canonical_key, e.attrs
  from entity e
);--> statement-breakpoint
CREATE VIEW "public"."v_interests" AS (
  select i.id as interest_id,
         i.official_entity as official_entity_id, oe.name as official_name, oe.canonical_key as official_key,
         i.year,
         i.business_entity as business_entity_id, be.name as business_name, be.canonical_key as business_key,
         i.kind, i.value_range,
         i.filing_id as filing_uuid, f.source as filing_source, f.filing_id, f.amendment_no, f.form, f.filed_at,
         f.url as filing_url
  from interest i
  left join entity oe on oe.id = i.official_entity
  left join entity be on be.id = i.business_entity
  left join filing f on f.id = i.filing_id
);--> statement-breakpoint
CREATE VIEW "public"."v_lobby" AS (
  select la.id as activity_id,
         la.employer_entity as employer_entity_id, ee.name as employer_name, ee.canonical_key as employer_key,
         la.firm_entity as firm_entity_id, fe.name as firm_name, fe.canonical_key as firm_key,
         la.period_start, la.period_end, la.amount, la.bills,
         la.filing_id as filing_uuid, f.source as filing_source, f.filing_id, f.amendment_no, f.form, f.filed_at,
         f.url as filing_url
  from lobby_activity la
  left join entity ee on ee.id = la.employer_entity
  left join entity fe on fe.id = la.firm_entity
  left join filing f on f.id = la.filing_id
);--> statement-breakpoint
CREATE VIEW "public"."v_money" AS (
  select me.id as edge_id, me.kind, me.amount, me.date, me.schedule, me.line_item,
         me.from_entity as from_entity_id, fe.name as from_name, fe.kind as from_kind, fe.canonical_key as from_key,
         me.to_entity as to_entity_id, te.name as to_name, te.kind as to_kind, te.canonical_key as to_key,
         me.filing_id as filing_uuid, f.source as filing_source, f.filing_id, f.amendment_no, f.form, f.filed_at,
         f.period_start, f.period_end, f.url as filing_url
  from money_edge me
  left join entity fe on fe.id = me.from_entity
  left join entity te on te.id = me.to_entity
  left join filing f on f.id = me.filing_id
);--> statement-breakpoint
CREATE VIEW "public"."v_votes" AS (
  select v.id as vote_id, v.bill_id, b.session, b.measure, b.title as bill_title, b.status as bill_status,
         v.legislator_entity as legislator_entity_id, e.name as legislator_name, e.canonical_key as legislator_key,
         v.vote_date, v.motion, v.location, v.result
  from vote v
  left join bill b on b.id = v.bill_id
  left join entity e on e.id = v.legislator_entity
);