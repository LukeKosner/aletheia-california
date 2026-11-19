/**
 * Aletheia database schema.
 *
 * Rules:
 * - Every table has `id uuid primary key` and `created_at`.
 * - Change this file, then run `bun run db:generate` (drizzle-kit generate) and commit the migration.
 */
import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgRole,
  pgSchema,
  pgTable,
  pgView,
  real,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

const base = {
  id: uuid("id").primaryKey().defaultRandom(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
};

const money = (name: string) => numeric(name, { precision: 14, scale: 2 });

// ---------- enums ----------

export const entityKind = pgEnum("entity_kind", [
  "person",
  "org",
  "committee",
  "candidate",
  "measure",
  "legislator",
  "lobby_firm",
  "official",
]);

export const moneyEdgeKind = pgEnum("money_edge_kind", [
  "contribution",
  "transfer",
  "ie_support",
  "ie_oppose",
  "expenditure",
  "loan",
]);

export const billAuthorRole = pgEnum("bill_author_role", ["lead", "coauthor"]);
export const voteResult = pgEnum("vote_result", ["aye", "no", "nvr"]);
export const claimConfidence = pgEnum("claim_confidence", ["high", "likely"]);
export const claimVerdict = pgEnum("claim_verdict", ["supported", "overstated", "unsupported"]);
export const correctionStatus = pgEnum("correction_status", ["open", "fixed", "rejected"]);

// ---------- entities ----------

export const entity = pgTable("entity", {
  ...base,
  kind: entityKind("kind").notNull(),
  name: text("name").notNull(),
  canonicalKey: text("canonical_key").notNull().unique(),
  attrs: jsonb("attrs").$type<Record<string, unknown>>().notNull().default({}),
});

export const entityAlias = pgTable(
  "entity_alias",
  {
    ...base,
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entity.id, { onDelete: "cascade" }),
    rawName: text("raw_name").notNull(),
    source: text("source").notNull(),
    sourceRowId: text("source_row_id"),
    matchScore: real("match_score"),
    method: text("method"),
  },
  (t) => [index("entity_alias_entity_idx").on(t.entityId), index("entity_alias_raw_name_idx").on(t.rawName)],
);

// ---------- filings and money ----------

export const filing = pgTable(
  "filing",
  {
    ...base,
    source: text("source").notNull(),
    filingId: text("filing_id").notNull(),
    amendmentNo: integer("amendment_no").notNull().default(0),
    form: text("form"),
    filedAt: timestamp("filed_at", { withTimezone: true }),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    url: text("url"),
    rawSha256: text("raw_sha256"),
  },
  (t) => [uniqueIndex("filing_source_filing_amendment_uq").on(t.source, t.filingId, t.amendmentNo)],
);

export const moneyEdge = pgTable(
  "money_edge",
  {
    ...base,
    fromEntity: uuid("from_entity")
      .notNull()
      .references(() => entity.id),
    toEntity: uuid("to_entity")
      .notNull()
      .references(() => entity.id),
    amount: money("amount").notNull(),
    date: date("date"),
    kind: moneyEdgeKind("kind").notNull(),
    filingId: uuid("filing_id").references(() => filing.id),
    schedule: text("schedule"),
    lineItem: text("line_item"),
  },
  (t) => [
    index("money_edge_from_idx").on(t.fromEntity),
    index("money_edge_to_idx").on(t.toEntity),
    index("money_edge_filing_idx").on(t.filingId),
  ],
);

export const lobbyActivity = pgTable(
  "lobby_activity",
  {
    ...base,
    employerEntity: uuid("employer_entity")
      .notNull()
      .references(() => entity.id),
    firmEntity: uuid("firm_entity").references(() => entity.id),
    periodStart: date("period_start"),
    periodEnd: date("period_end"),
    amount: money("amount"),
    filingId: uuid("filing_id").references(() => filing.id),
    bills: text("bills").array().notNull().default([]),
  },
  (t) => [index("lobby_activity_employer_idx").on(t.employerEntity), index("lobby_activity_firm_idx").on(t.firmEntity)],
);

// ---------- legislature ----------

export const bill = pgTable(
  "bill",
  {
    ...base,
    session: text("session").notNull(),
    measure: text("measure").notNull(),
    title: text("title"),
    status: text("status"),
  },
  (t) => [uniqueIndex("bill_session_measure_uq").on(t.session, t.measure)],
);

export const billAuthor = pgTable(
  "bill_author",
  {
    ...base,
    billId: uuid("bill_id")
      .notNull()
      .references(() => bill.id, { onDelete: "cascade" }),
    legislatorEntity: uuid("legislator_entity")
      .notNull()
      .references(() => entity.id),
    role: billAuthorRole("role").notNull(),
  },
  (t) => [index("bill_author_bill_idx").on(t.billId), index("bill_author_legislator_idx").on(t.legislatorEntity)],
);

export const vote = pgTable(
  "vote",
  {
    ...base,
    billId: uuid("bill_id")
      .notNull()
      .references(() => bill.id, { onDelete: "cascade" }),
    legislatorEntity: uuid("legislator_entity")
      .notNull()
      .references(() => entity.id),
    voteDate: date("vote_date"),
    motion: text("motion"),
    location: text("location"),
    result: voteResult("result").notNull(),
  },
  (t) => [index("vote_bill_idx").on(t.billId), index("vote_legislator_idx").on(t.legislatorEntity)],
);

// ---------- statements of economic interests (Form 700) ----------

export const interest = pgTable(
  "interest",
  {
    ...base,
    officialEntity: uuid("official_entity")
      .notNull()
      .references(() => entity.id),
    year: integer("year").notNull(),
    businessEntity: uuid("business_entity").references(() => entity.id),
    kind: text("kind"),
    valueRange: text("value_range"),
    filingId: uuid("filing_id").references(() => filing.id),
  },
  (t) => [index("interest_official_idx").on(t.officialEntity)],
);

// ---------- investigations, claims, cards ----------

export const investigation = pgTable("investigation", {
  ...base,
  type: text("type").notNull(),
  question: text("question").notNull(),
  status: text("status").notNull(),
  userId: text("user_id"),
  harnessTaskId: text("harness_task_id"),
  costUsd: numeric("cost_usd", { precision: 12, scale: 6 }),
  tokens: integer("tokens"),
  methodVersion: text("method_version"),
});

export const claim = pgTable(
  "claim",
  {
    ...base,
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigation.id, { onDelete: "cascade" }),
    sentence: text("sentence").notNull(),
    edgeIds: uuid("edge_ids").array().notNull().default([]),
    filingIds: uuid("filing_ids").array().notNull().default([]),
    confidence: claimConfidence("confidence"),
    verdict: claimVerdict("verdict"),
    verifierModel: text("verifier_model"),
  },
  (t) => [index("claim_investigation_idx").on(t.investigationId)],
);

export const card = pgTable(
  "card",
  {
    ...base,
    investigationId: uuid("investigation_id")
      .notNull()
      .references(() => investigation.id),
    type: text("type").notNull(),
    methodVersion: text("method_version"),
    published: boolean("published").notNull().default(false),
    imagePath: text("image_path"),
  },
  (t) => [index("card_investigation_idx").on(t.investigationId)],
);

// ---------- feedback, corrections, events ----------

export const feedback = pgTable("feedback", {
  ...base,
  targetKind: text("target_kind").notNull(),
  targetId: uuid("target_id").notNull(),
  userId: text("user_id"),
  choice: text("choice"),
  text: text("text"),
});

export const correction = pgTable(
  "correction",
  {
    ...base,
    cardId: uuid("card_id")
      .notNull()
      .references(() => card.id),
    request: text("request").notNull(),
    status: correctionStatus("status").notNull().default("open"),
    resolution: text("resolution"),
  },
  (t) => [index("correction_card_idx").on(t.cardId)],
);

export const event = pgTable(
  "event",
  {
    ...base,
    name: text("name").notNull(),
    userId: text("user_id"),
    campus: text("campus"),
    props: jsonb("props").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("event_name_idx").on(t.name)],
);

// ---------- agent read surface (packages/tools) ----------
//
// Agents never read tables. They read these six views through the MCP server in packages/tools, connected as
// `agent_ro`. The views run with their owner's rights (no security_invoker), so `agent_ro` needs SELECT on the
// views only, never on the tables. drizzle-kit cannot express GRANTs or role settings; the human step that
// grants SELECT and sets the 10 s statement timeout is in packages/tools/README.md.
//
// Joins to entity and filing are LEFT JOINs on primary keys so Postgres drops them when a query (for example
// trace_money's recursive walk) reads only edge columns.

/** Read-only role for agents: SELECT on the six v_* views, nothing else. */
export const agentRo = pgRole("agent_ro");
/** Server-side writer for the MCP `cite` tool: INSERT on claim, nothing else. Never handed to an agent. */
export const claimWriter = pgRole("claim_writer");

export const vMoney = pgView("v_money", {
  edgeId: uuid("edge_id"),
  kind: moneyEdgeKind("kind"),
  amount: money("amount"),
  date: date("date"),
  schedule: text("schedule"),
  lineItem: text("line_item"),
  fromEntityId: uuid("from_entity_id"),
  fromName: text("from_name"),
  fromKind: entityKind("from_kind"),
  fromKey: text("from_key"),
  toEntityId: uuid("to_entity_id"),
  toName: text("to_name"),
  toKind: entityKind("to_kind"),
  toKey: text("to_key"),
  filingUuid: uuid("filing_uuid"),
  filingSource: text("filing_source"),
  filingId: text("filing_id"),
  amendmentNo: integer("amendment_no"),
  form: text("form"),
  filedAt: timestamp("filed_at", { withTimezone: true }),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  filingUrl: text("filing_url"),
}).as(sql`
  select me.id as edge_id, me.kind, me.amount, me.date, me.schedule, me.line_item,
         me.from_entity as from_entity_id, fe.name as from_name, fe.kind as from_kind, fe.canonical_key as from_key,
         me.to_entity as to_entity_id, te.name as to_name, te.kind as to_kind, te.canonical_key as to_key,
         me.filing_id as filing_uuid, f.source as filing_source, f.filing_id, f.amendment_no, f.form, f.filed_at,
         f.period_start, f.period_end, f.url as filing_url
  from money_edge me
  left join entity fe on fe.id = me.from_entity
  left join entity te on te.id = me.to_entity
  left join filing f on f.id = me.filing_id
`);

export const vLobby = pgView("v_lobby", {
  activityId: uuid("activity_id"),
  employerEntityId: uuid("employer_entity_id"),
  employerName: text("employer_name"),
  employerKey: text("employer_key"),
  firmEntityId: uuid("firm_entity_id"),
  firmName: text("firm_name"),
  firmKey: text("firm_key"),
  periodStart: date("period_start"),
  periodEnd: date("period_end"),
  amount: money("amount"),
  bills: text("bills").array(),
  filingUuid: uuid("filing_uuid"),
  filingSource: text("filing_source"),
  filingId: text("filing_id"),
  amendmentNo: integer("amendment_no"),
  form: text("form"),
  filedAt: timestamp("filed_at", { withTimezone: true }),
  filingUrl: text("filing_url"),
}).as(sql`
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
`);

export const vVotes = pgView("v_votes", {
  voteId: uuid("vote_id"),
  billId: uuid("bill_id"),
  session: text("session"),
  measure: text("measure"),
  billTitle: text("bill_title"),
  billStatus: text("bill_status"),
  legislatorEntityId: uuid("legislator_entity_id"),
  legislatorName: text("legislator_name"),
  legislatorKey: text("legislator_key"),
  voteDate: date("vote_date"),
  motion: text("motion"),
  location: text("location"),
  result: voteResult("result"),
}).as(sql`
  select v.id as vote_id, v.bill_id, b.session, b.measure, b.title as bill_title, b.status as bill_status,
         v.legislator_entity as legislator_entity_id, e.name as legislator_name, e.canonical_key as legislator_key,
         v.vote_date, v.motion, v.location, v.result
  from vote v
  left join bill b on b.id = v.bill_id
  left join entity e on e.id = v.legislator_entity
`);

export const vBillAuthors = pgView("v_bill_authors", {
  billId: uuid("bill_id"),
  session: text("session"),
  measure: text("measure"),
  billTitle: text("bill_title"),
  billStatus: text("bill_status"),
  legislatorEntityId: uuid("legislator_entity_id"),
  legislatorName: text("legislator_name"),
  legislatorKey: text("legislator_key"),
  role: billAuthorRole("role"),
}).as(sql`
  select ba.bill_id, b.session, b.measure, b.title as bill_title, b.status as bill_status,
         ba.legislator_entity as legislator_entity_id, e.name as legislator_name, e.canonical_key as legislator_key,
         ba.role
  from bill_author ba
  left join bill b on b.id = ba.bill_id
  left join entity e on e.id = ba.legislator_entity
`);

export const vEntities = pgView("v_entities", {
  entityId: uuid("entity_id"),
  kind: entityKind("kind"),
  name: text("name"),
  canonicalKey: text("canonical_key"),
  attrs: jsonb("attrs"),
}).as(sql`
  select e.id as entity_id, e.kind, e.name, e.canonical_key, e.attrs
  from entity e
`);

export const vInterests = pgView("v_interests", {
  interestId: uuid("interest_id"),
  officialEntityId: uuid("official_entity_id"),
  officialName: text("official_name"),
  officialKey: text("official_key"),
  year: integer("year"),
  businessEntityId: uuid("business_entity_id"),
  businessName: text("business_name"),
  businessKey: text("business_key"),
  kind: text("kind"),
  valueRange: text("value_range"),
  filingUuid: uuid("filing_uuid"),
  filingSource: text("filing_source"),
  filingId: text("filing_id"),
  amendmentNo: integer("amendment_no"),
  form: text("form"),
  filedAt: timestamp("filed_at", { withTimezone: true }),
  filingUrl: text("filing_url"),
}).as(sql`
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
`);

// ---------- private, server-only Better Auth identity ----------
// UUIDs preserve compatibility with downstream user references. Auth adapters get
// auth_server credentials limited to these tables, never the ingest/owner URL.
export const authUser = pgTable("auth_user", {
  ...base,
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  campus: text("campus"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
export const authSession = pgTable("auth_session", {
  ...base,
  userId: uuid("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  token: text("token").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  ipAddress: text("ip_address"),
  userAgent: text("user_agent"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("auth_session_user_idx").on(t.userId)]);
export const authAccount = pgTable("auth_account", {
  ...base,
  userId: uuid("user_id").notNull().references(() => authUser.id, { onDelete: "cascade" }),
  accountId: text("account_id").notNull(),
  providerId: text("provider_id").notNull(),
  accessToken: text("access_token"),
  refreshToken: text("refresh_token"),
  idToken: text("id_token"),
  accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
  refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
  scope: text("scope"),
  password: text("password"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("auth_account_user_idx").on(t.userId)]);
export const authVerification = pgTable("auth_verification", {
  ...base,
  identifier: text("identifier").notNull(),
  value: text("value").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("auth_verification_identifier_idx").on(t.identifier)]);
export const authRateLimit = pgTable("auth_rate_limit", {
  ...base,
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: bigint("last_request", { mode: "number" }).notNull(),
});

// ---------- voter interviews (separate `interview` schema) ----------
//
// Voice interviews, the research they request, and Stripe test-mode payments live in their own Postgres
// schema so the filings data above is never touched. The web app writes here only as the human-provisioned
// `interview_app` role (scripts/provision_interview_db.py), which has no rights outside this schema.

export const interviewSchema = pgSchema("interview");

/** An interview a government or business sets up; Aletheia conducts it with voters. */
export const interviewStudy = interviewSchema.table("study", {
  ...base,
  /** government | business */
  sponsorKind: text("sponsor_kind").notNull(),
  sponsorName: text("sponsor_name").notNull(),
  title: text("title").notNull(),
  goal: text("goal").notNull(),
  questions: text("questions").array().notNull(),
  /** draft until paid, then open */
  status: text("status").notNull().default("draft"),
  /**
   * Which profile fields the person interviewed fills in: standard keys (county, ageRange, party,
   * voteLikelihood, city) plus up to three sponsor-written multiple-choice fields. Null on older studies.
   */
  fields: jsonb("fields").$type<{ standard: string[]; custom: { label: string; options: string[] }[] }>(),
  /** How many interviews the sponsor bought. */
  interviewTarget: integer("interview_target").notNull().default(20),
  /** What the sponsor is charged to launch the study, in cents. */
  priceCents: integer("price_cents").notNull().default(14900),
});

export const interviewSession = interviewSchema.table(
  "session",
  {
    ...base,
    /** Set when the voter took a sponsor's study rather than the general interview. */
    studyId: uuid("study_id").references(() => interviewStudy.id, { onDelete: "set null" }),
    /** Where to send the $5 reward. Never shown publicly. */
    rewardEmail: text("reward_email"),
    /** Answers to the study's questions, in order. */
    answers: jsonb("answers").$type<{ question: string; answer: string }[]>().notNull().default([]),
    /** draft → in_progress → completed */
    status: text("status").notNull().default("draft"),
    county: text("county").notNull(),
    ageRange: text("age_range").notNull(),
    party: text("party").notNull(),
    voteLikelihood: text("vote_likelihood").notNull(),
    /** Voter agreed that the transcript and answers are public. */
    publicConsent: boolean("public_consent").notNull(),
    transcript: jsonb("transcript").$type<{ role: "voter" | "interviewer"; text: string }[]>().notNull().default([]),
    issues: text("issues").array().notNull().default([]),
    questions: text("questions").array().notNull().default([]),
    candidateViews: text("candidate_views").array().notNull().default([]),
    summary: text("summary"),
    wantsResearch: boolean("wants_research").notNull().default(false),
    /** Extra profile answers the study asked for (city or town, sponsor-written fields), keyed by label. */
    profile: jsonb("profile").$type<Record<string, string>>().notNull().default({}),
    /** Richer interview content: trusted information sources, short quotes, a message to leaders. */
    details: jsonb("details").$type<{ sources?: string[]; quotes?: string[]; toLeaders?: string | null }>().notNull().default({}),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("interview_session_status_idx").on(t.status), index("interview_session_county_idx").on(t.county)],
);

export const interviewResearch = interviewSchema.table(
  "research",
  {
    ...base,
    /** Null for periodic research run across all interviews. */
    sessionId: uuid("session_id").references(() => interviewSession.id, { onDelete: "cascade" }),
    /** voter | periodic */
    origin: text("origin").notNull(),
    question: text("question").notNull(),
    /** public.investigation id once the HarnessRouter run starts. */
    investigationId: uuid("investigation_id"),
    status: text("status").notNull().default("queued"),
    error: text("error"),
  },
  (t) => [index("interview_research_session_idx").on(t.sessionId), index("interview_research_origin_idx").on(t.origin)],
);

export const interviewPayment = interviewSchema.table(
  "payment",
  {
    ...base,
    sessionId: uuid("session_id").references(() => interviewSession.id, { onDelete: "set null" }),
    /** research | reports_pass | test_top_up */
    product: text("product").notNull(),
    stripeId: text("stripe_id").notNull(),
    amountCents: integer("amount_cents").notNull(),
    status: text("status").notNull(),
  },
  (t) => [uniqueIndex("interview_payment_stripe_idx").on(t.stripeId)],
);

export const interviewPayout = interviewSchema.table("payout", {
  ...base,
  stripeId: text("stripe_id").notNull(),
  amountCents: integer("amount_cents").notNull(),
  status: text("status").notNull(),
  note: text("note"),
});
