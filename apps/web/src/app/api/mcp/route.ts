/**
 * MCP server for agents: the only way agents touch data (AGENTS.md rule 4).
 *
 * Streamable HTTP, bearer token from MCP_BEARER_TOKEN, five tools from @aletheia/tools (query, trace_money,
 * get_filing, vote_base_rate, cite) plus interview_insights. Reads go through the agent_ro role; cite writes through
 * claim_writer. interview_insights only SELECTs public, completed interviews and returns counts and voter questions:
 * never emails, transcripts or ids. Send X-Aletheia-Investigation-Id so cite knows which investigation a claim belongs to.
 */
import { createMcpFetchHandler, untrusted, type InterviewInsightsFilter } from "@aletheia/tools";
import { readFlags } from "@/lib/flags";
import { interviewInsights } from "@/lib/interview/insights";
import { completedSessions } from "@/lib/interview/store";

async function insights(filter: InterviewInsightsFilter) {
  if (!readFlags().INTERVIEW_PREVIEW) throw new Error("Aletheia interviews are not available.");
  // Public interviews only: sponsored study interviews belong to their sponsor.
  const result = interviewInsights(await completedSessions(2000, { publicOnly: true }), filter);
  return { ...result, common_questions: result.common_questions.map((q) => ({ question: untrusted(q.question), count: q.count })) };
}

const handle = createMcpFetchHandler({ interviewInsights: insights });

export const POST = (request: Request) => handle(request);
export const GET = (request: Request) => handle(request);
export const DELETE = (request: Request) => handle(request);
