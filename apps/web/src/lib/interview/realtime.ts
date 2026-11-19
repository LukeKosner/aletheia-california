/** OpenAI Realtime session setup for the voice interview. The API key never leaves the server. */
import { ISSUES, NOT_ASKED, SPONSOR_KINDS, type SponsorKind } from "./taxonomy";
import { InterviewError, type SessionRow, type StudyRow } from "./store";

export const SUBMIT_TOOL = "submit_interview";

type Study = Pick<StudyRow, "sponsorKind" | "sponsorName" | "title" | "goal" | "questions"> | null;
type Person = Pick<SessionRow, "county" | "ageRange" | "party" | "voteLikelihood"> & { profile?: Record<string, string> | null };
/** How the voice model saves: a direct tool call (Realtime) or a request to the delegated backend (GPT-Live). */
type SaveMode = "tool" | "delegate";

/**
 * The voice model never says the project's name. Spelled "Aletheia" it put the stress on "thee"; spelled as it sounds,
 * the live transcript showed the sound-out spelling. So it refers to "this project" and "we" instead.
 */
const NO_NAME = "Do not say the project's name. Refer to it as \"this project\" or \"we\".";
const NEUTRAL = "Describe facts, never motive. Never use these words: bought, paid off, corrupt, in the pocket of, bribe, kickback, rigged, puppet.";
const PACE = "Ask one question at a time, then wait for the answer. After each answer, reflect it back in a few words (for example, \"So rent going up every year is the biggest worry.\") before you move on. When an answer is vague, ask for a concrete example or detail, at most twice on the same point, then move on. Keep your own turns short. Speak in the person's language. If they want to stop early, respect that.";

/** The form answers the person gave, leaving out fields the study did not ask for. */
export function describeProfile(s: Person): string {
  const entries: [string, string][] = [
    ["county", s.county === NOT_ASKED ? "" : `${s.county} County`], ["age", s.ageRange], ["party preference", s.party], ["plans to vote", s.voteLikelihood],
    ...Object.entries(s.profile ?? {}),
  ];
  const given = entries.filter(([, v]) => v && v !== NOT_ASKED).map(([k, v]) => `${k}: ${v}`);
  return given.length ? `The person filled in a short form: ${given.join("; ")}.` : "";
}

const SAVE = {
  voter: {
    tool: `call ${SUBMIT_TOOL} once with everything they said.`,
    delegate: "delegate to the backend to save the interview. In that request, include every issue they raised, each question they want answered, their views on candidates or measures, the information sources they trust, up to three short quotes in their own words, what they would tell California's leaders, and a short neutral summary.",
  },
  study: {
    tool: `call ${SUBMIT_TOOL} once with an answer for each study question.`,
    delegate: "delegate to the backend to save the interview. In that request, include each study question with the person's full answer (their reasons and examples), the issues they raised, up to three short quotes in their own words, and a short neutral summary.",
  },
} as const;

export function instructions(s: Person, study: Study = null, mode: SaveMode = "tool"): string {
  if (study) return studyInstructions(s, study, mode);
  return [
    "You are a warm, neutral, nonpartisan interviewer for a California civic research project that reads public campaign-finance, lobbying and legislative records.",
    NO_NAME,
    describeProfile(s),
    "This is an in-depth conversation of about ten minutes.",
    PACE,
    "Start by greeting them in one or two sentences, saying the interview takes about ten minutes, and reminding them that their answers are published without their name, so they should not share their name, address or other identifying details. Then cover these parts, in order:",
    "1. Warm-up: how things have been going lately where they live in California.",
    "2. Top issues: the two or three issues that matter most to them in California right now. For each one, ask why, and ask for a concrete example from their own life or from someone they know.",
    "3. Effect: how those issues affect them, their family or their community day to day.",
    "4. Who funds or influences it: what they know or have heard about who funds, lobbies on or otherwise shapes those issues, and what they would want to find out. Help them put what they want to find out into clear questions.",
    "5. Information: where they get news and information about California politics, which sources they trust, and why.",
    "6. Ballot (optional): whether they have views on 2026 California ballot measures or candidates that they are comfortable sharing. If they would rather not say, move on without pressing.",
    "7. Leaders: if they could tell California's leaders one thing, what it would be.",
    "8. Wrap-up: whether there is anything else they want to add.",
    `Never give your own opinion, never try to persuade, and never state facts about who funds whom: if asked, say the project checks the public filings.`,
    NEUTRAL,
    `When you have covered these parts, or the person asks to finish, ${SAVE.voter[mode]}`,
    `After saving, thank them warmly in one sentence. Then mention once, lightly, that we will look up their questions in public records for free and they will see what it finds on the next screen. Do not ask whether they want this. Then say goodbye.`,
  ].filter(Boolean).join("\n");
}

/** A sponsor's study: ask the sponsor's questions, in order, as a neutral interviewer, with follow-ups. */
function studyInstructions(s: Person, study: NonNullable<Study>, mode: SaveMode): string {
  const kind = SPONSOR_KINDS[study.sponsorKind as SponsorKind]?.toLowerCase() ?? "organization";
  return [
    `You are a warm, neutral, nonpartisan interviewer for a California civic research project, running a study for ${study.sponsorName} (a ${kind}).`,
    NO_NAME,
    `Study: ${study.title}. What they want to learn: ${study.goal}`,
    describeProfile(s),
    "This interview takes about ten minutes.",
    PACE,
    "Start by greeting them in one or two sentences, saying who the study is for, that it takes about ten minutes, and that their answers go only to that organization and are not published; they still should not share their name, address or other identifying details. Ask one short, easy warm-up question about the study's topic. Then ask these questions one at a time, in order:",
    ...study.questions.map((q, i) => `${i + 1}. ${q}`),
    "Ask each question exactly as written; it was reviewed for neutrality when the study was saved. After each answer, ask up to two follow-ups that dig into why, or ask for a concrete example, before moving to the next question.",
    `When the questions are done, ask whether there is anything else they would like ${study.sponsorName} to know.`,
    "Never give your own opinion and never try to persuade. Do not answer for the sponsor or promise anything on their behalf.",
    NEUTRAL,
    `When every question is answered, or the person asks to finish, ${SAVE.study[mode]}`,
    "Then thank them warmly in one sentence and say goodbye.",
  ].filter(Boolean).join("\n");
}

const list = (description: string, maxItems: number) => ({ type: "array", items: { type: "string" }, maxItems, description });

export const submitTool = {
  type: "function",
  name: SUBMIT_TOOL,
  description: "Save the structured results of the interview. Call exactly once at the end.",
  parameters: {
    type: "object",
    additionalProperties: false,
    properties: {
      issues: { type: "array", items: { type: "string", enum: [...ISSUES] }, maxItems: 5, description: "The person's top issues, most important first." },
      questions: list("Questions the person wants answered about public funding, lobbying, measures or candidates, in their words, each one sentence.", 6),
      candidate_views: list("Short neutral notes on the person's stated views of candidates or measures, e.g. 'Leaning yes on the housing bond'. Empty if they did not share any.", 6),
      sources: list("Where the person gets political news and information, and which sources they trust, e.g. 'Local TV news (trusts it most)'.", 6),
      quotes: list("Up to three short quotes in the person's own words that capture what matters to them. No names or identifying details.", 3),
      to_leaders: { type: "string", description: "What the person would tell California's leaders, in one or two neutral sentences. Empty if they did not say." },
      summary: { type: "string", description: "Three to five neutral sentences summarizing what the person said, including the reasons and examples they gave." },
      answers: {
        type: "array", maxItems: 6,
        description: "For a sponsored study only: one entry per study question, in order, with the person's answer in two or three neutral sentences, including their reasons and examples. Empty otherwise.",
        items: { type: "object", additionalProperties: false, properties: { question: { type: "string" }, answer: { type: "string" } }, required: ["question", "answer"] },
      },
    },
    required: ["issues", "questions", "candidate_views", "summary"],
  },
} as const;

export type Protocol = "live" | "realtime";

const DELEGATE_INSTRUCTIONS = `You are the back office for a voice interview with a Californian. When the interviewer asks you to save the interview, call ${SUBMIT_TOOL} exactly once with what the person said, using neutral language. Do not call it otherwise. Reply with one short sentence confirming the save.`;

async function openai(path: string, body: unknown, key: string, contentType = "application/json"): Promise<Response> {
  return fetch(`https://api.openai.com/v1/${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": contentType },
    signal: AbortSignal.timeout(30_000),
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

async function fail(response: Response, label: string): Promise<never> {
  const json = (await response.json().catch(() => ({}))) as { error?: { message?: string } };
  throw new InterviewError("openai_error", `${label}: ${json.error?.message ?? "could not start a session."}`, 502);
}

/**
 * When the voter presses Finish, the server turns the transcript into the structured result itself, with a
 * forced submit_interview call, instead of waiting for the voice model to decide to delegate.
 */
export async function summarize(transcript: { role: string; text: string }[], study: Study, env = process.env): Promise<unknown> {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new InterviewError("openai_not_configured", "OPENAI_API_KEY is not set in apps/web/.env.local.", 503);
  const studyNote = study ? ` This interview was a study for ${study.sponsorName}. Its questions, in order: ${study.questions.map((q, i) => `${i + 1}. ${q}`).join(" ")} Give one answer per question.` : " Leave answers empty.";
  const response = await openai("responses", {
    model: env.OPENAI_DELEGATE_MODEL || "gpt-5.6-terra",
    instructions: `Read this interview transcript and call ${SUBMIT_TOOL} once with what the person said, in neutral language. Write each answer as the person's point stated plainly (for example "Rent is too high."), not "The person said…". Include the sources they trust, up to three short quotes in their own words, and what they would tell leaders, when they gave them.${studyNote}`,
    input: transcript.map((l) => `${l.role === "voter" ? "Person" : "Interviewer"}: ${l.text}`).join("\n").slice(0, 60_000) || "(empty transcript)",
    tools: [submitTool],
    tool_choice: { type: "function", name: SUBMIT_TOOL },
  }, key);
  if (!response.ok) await fail(response, "OpenAI");
  const json = (await response.json()) as { output?: { type?: string; name?: string; arguments?: string }[] };
  const call = json.output?.find((o) => o.type === "function_call" && o.name === SUBMIT_TOOL);
  try { return JSON.parse(call?.arguments ?? "{}"); } catch { return {}; }
}

/**
 * Exchanges the browser's WebRTC SDP offer for an answer. GPT-Live models (default gpt-live-1) use
 * POST /v1/live/sessions with tools on a delegated Responses backend; gpt-realtime* models use the Realtime API.
 */
export async function connect(session: SessionRow, offer: string, study: Study = null, env = process.env): Promise<{ sdp: string; protocol: Protocol; model: string }> {
  const key = env.OPENAI_API_KEY;
  if (!key) throw new InterviewError("openai_not_configured", "OPENAI_API_KEY is not set in apps/web/.env.local.", 503);
  const model = env.OPENAI_REALTIME_MODEL || "gpt-live-1";

  if (!model.startsWith("gpt-realtime")) {
    const response = await openai("live/sessions", {
      session: {
        model,
        instructions: instructions(session, study, "delegate"),
        audio: { output: { voice: "marin" } },
        delegation: {
          type: "responses",
          responses: { model: env.OPENAI_DELEGATE_MODEL || "gpt-5.6-terra", instructions: DELEGATE_INSTRUCTIONS, tools: [submitTool], tool_choice: "auto" },
        },
      },
      transport: { type: "webrtc", sdp: offer },
    }, key);
    if (!response.ok) await fail(response, "OpenAI GPT-Live");
    const json = (await response.json()) as { transport?: { sdp?: string } };
    if (typeof json.transport?.sdp !== "string") throw new InterviewError("openai_error", "OpenAI GPT-Live returned no SDP answer.", 502);
    return { sdp: json.transport.sdp, protocol: "live", model };
  }

  const secret = await openai("realtime/client_secrets", {
    expires_after: { anchor: "created_at", seconds: 600 },
    session: {
      type: "realtime",
      model,
      instructions: instructions(session, study, "tool"),
      audio: {
        input: { transcription: { model: env.OPENAI_TRANSCRIBE_MODEL || "gpt-4o-mini-transcribe" }, turn_detection: { type: "semantic_vad" } },
        output: { voice: "marin" },
      },
      tools: [submitTool],
      tool_choice: "auto",
    },
  }, key);
  if (!secret.ok) await fail(secret, "OpenAI Realtime");
  const { value } = (await secret.json()) as { value: string };
  const answer = await openai("realtime/calls", offer, value, "application/sdp");
  if (!answer.ok) await fail(answer, "OpenAI Realtime");
  return { sdp: await answer.text(), protocol: "realtime", model };
}
