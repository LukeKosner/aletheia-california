CREATE VIEW "public"."v_bill_authors" AS (
  select ba.bill_id, b.session, b.measure, b.title as bill_title, b.status as bill_status,
         ba.legislator_entity as legislator_entity_id, e.name as legislator_name, e.canonical_key as legislator_key,
         ba.role
  from bill_author ba
  left join bill b on b.id = ba.bill_id
  left join entity e on e.id = ba.legislator_entity
);