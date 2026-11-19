import { readOnly, TEXT_DATES, type ToolsDb } from "../db";
import { untrusted, type UntrustedText } from "../untrusted";

export const TRACE_MAX_DEPTH = 5;
/** Counterparties followed from each entity, largest single edge first. */
export const TRACE_FANOUT = 10;
/** Path prefixes the recursive walk may return. */
export const TRACE_MAX_ROWS = 500;
/** Edge ids kept per hop (all edges between the same two entities). */
export const TRACE_MAX_EDGES_PER_HOP = 50;

export type Direction = "up" | "down";

export interface TraceInput {
  entity_id: string;
  direction: Direction;
  max_depth: number;
  min_amount: number;
}

interface Hop {
  from_entity_id: string;
  to_entity_id: string;
  edge_ids: string[];
  n_edges: number;
  largest_amount: string;
}

export interface TraceEntity {
  entity_id: string;
  kind: string | null;
  canonical_key: string | null;
  name: UntrustedText | null;
}

export interface TraceEdge {
  edge_id: string;
  kind: string;
  amount: string;
  date: string | null;
  schedule: string | null;
  line_item: string | null;
  from_entity_id: string;
  to_entity_id: string;
  filing_uuid: string | null;
  filing_id: string | null;
  form: string | null;
  filing_url: string | null;
}

export interface TraceResult {
  root: TraceEntity | null;
  direction: Direction;
  max_depth: number;
  min_amount: number;
  paths: { depth: number; entity_ids: string[]; hops: Hop[] }[];
  entities: TraceEntity[];
  edges: TraceEdge[];
  truncated: boolean;
  note: string;
}

const NOTE =
  "Each hop lists every edge between the two entities at or above min_amount. One contribution is often reported " +
  "on several schedules (for example F497P1 and F497P2 late reports, then Form 460 Schedule A on the recipient side " +
  "and Schedule E or D on the giver side), so do not add amounts across schedules. Paths follow at most " +
  `${TRACE_FANOUT} counterparties per entity, largest single edge first.`;

/**
 * Walks money edges from an entity. `up` follows money into the entity back to its sources (who funds it); `down`
 * follows money out of it (where its money goes). A path never visits an entity twice.
 */
export async function traceMoney(db: ToolsDb, input: TraceInput): Promise<TraceResult> {
  const depth = Math.max(1, Math.min(TRACE_MAX_DEPTH, Math.trunc(input.max_depth)));
  const min = Math.max(0, input.min_amount);
  const up = input.direction === "up";
  // Column names are fixed strings chosen here, never agent input.
  const here = up ? "to_entity_id" : "from_entity_id";
  const next = up ? "from_entity_id" : "to_entity_id";

  return readOnly(db, async (tx) => {
    const walk = await tx.unsafe<{ depth: number; nodes: string[]; hops: Hop[] }[]>(
      `
      with recursive walk(depth, node, nodes, hops) as (
        select 0, $1::uuid, array[$1::uuid], '[]'::jsonb
        union all
        select w.depth + 1, e.next, w.nodes || e.next,
               w.hops || jsonb_build_array(jsonb_build_object(
                 'from_entity_id', ${up ? "e.next" : "w.node"},
                 'to_entity_id', ${up ? "w.node" : "e.next"},
                 'edge_ids', to_jsonb(e.edge_ids[1:${TRACE_MAX_EDGES_PER_HOP}]),
                 'n_edges', e.n_edges,
                 'largest_amount', e.largest::text))
        from walk w
        cross join lateral (
          select m.${next} as next, max(m.amount) as largest, count(*) as n_edges,
                 array_agg(m.edge_id order by m.amount desc, m.edge_id) as edge_ids
          from v_money m
          where m.${here} = w.node and m.amount >= $2 and m.${next} <> all(w.nodes)
          group by m.${next}
          order by largest desc, next
          limit ${TRACE_FANOUT}
        ) e
        where w.depth < $3
      )
      select depth, nodes, hops from walk where depth > 0 limit ${TRACE_MAX_ROWS + 1}
      `,
      [input.entity_id, min, depth],
    );
    const truncated = walk.length > TRACE_MAX_ROWS;
    const rows = walk.slice(0, TRACE_MAX_ROWS);

    // Keep only paths that are not a prefix of another returned path.
    const parents = new Set(rows.map((r) => r.nodes.slice(0, -1).join(">")));
    const leaves = rows.filter((r) => !parents.has(r.nodes.join(">")));

    const entityIds = [...new Set([input.entity_id, ...rows.flatMap((r) => r.nodes)])];
    const edgeIds = [...new Set(rows.flatMap((r) => r.hops.flatMap((h) => h.edge_ids)))];

    const ents = await tx<{ entity_id: string; kind: string | null; canonical_key: string | null; name: string | null }[]>`
      select entity_id, kind::text as kind, canonical_key, name from v_entities where entity_id = any(${entityIds}::uuid[])
    `;
    const edges = edgeIds.length
      ? await tx<TraceEdge[]>`
          select edge_id, kind::text as kind, amount::text as amount, date, schedule, line_item, from_entity_id,
                 to_entity_id, filing_uuid, filing_id, form, filing_url
          from v_money where edge_id = any(${edgeIds}::uuid[])
          order by date, edge_id
        `.parsers(TEXT_DATES)
      : [];

    const entities = ents.map((e) => ({ ...e, name: untrusted(e.name) }));
    return {
      root: entities.find((e) => e.entity_id === input.entity_id) ?? null,
      direction: input.direction,
      max_depth: depth,
      min_amount: min,
      paths: leaves.map((r) => ({ depth: r.depth, entity_ids: r.nodes, hops: r.hops })),
      entities,
      edges: [...edges],
      truncated,
      note: NOTE,
    };
  });
}
