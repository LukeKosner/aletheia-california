"use client";
/**
 * Live voice interview over WebRTC. The browser sends its SDP offer to our server, which opens a GPT-Live
 * session (default gpt-live-1) and returns OpenAI's answer, so the API key never reaches the browser.
 * GPT-Live delegates the `submit_interview` tool call to a Responses backend; the call arrives here inside
 * `response.event`, and the transcript plus structured answers are saved. gpt-realtime* models still work.
 */
import { Mic, MicOff, Send } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";

type Role = "voter" | "interviewer";
type Line = { role: Role; text: string };
type Phase = "idle" | "connecting" | "live" | "saving" | "done" | "error";
type Protocol = "live" | "realtime";
type Json = Record<string, unknown>;

const SUBMIT_TOOL = "submit_interview";
const GREETING = "Begin the interview now: greet the person, say it takes about ten minutes, remind them it is public, and ask your first question, as your instructions say.";
/** Spoken: the interviewer never says the project's name (see NO_NAME in lib/interview/realtime.ts). */
const FINISH_VOTER = "The person pressed Finish. Thank them warmly in one short sentence. Then mention once, lightly, that we will look up their questions in public records for free and they will see it on the next screen. Do not ask anything. Say goodbye.";
const START_FAILED = "Couldn't start the interview. Try again in a minute.";
/** A message the server already wrote for people to read. */
class ServerMessage extends Error {}
const FINISH_STUDY = "The person pressed Finish. Thank them warmly in one short sentence and say goodbye.";

export function InterviewRoom({ id, study = false }: { id: string; study?: boolean }) {
  const router = useRouter();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [muted, setMuted] = useState(false);
  const [micBlocked, setMicBlocked] = useState(false);
  const [draft, setDraft] = useState("");
  const linesRef = useRef<Line[]>([]);
  const protocolRef = useRef<Protocol>("live");
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const dcRef = useRef<RTCDataChannel | null>(null);
  const micRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const savedRef = useRef(false);
  const bottomRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => () => stop(), []);
  useEffect(() => { bottomRef.current?.scrollIntoView({ block: "nearest" }); }, [lines]);

  /** Appends a streamed fragment, starting a new line whenever the speaker changes. */
  function append(role: Role, text: string, whole = false) {
    if (!text) return;
    const current = linesRef.current, last = current.at(-1);
    linesRef.current = last && last.role === role && !whole ? [...current.slice(0, -1), { role, text: last.text + text }] : [...current, { role, text: text.trim() }];
    setLines(linesRef.current);
  }

  function stop() {
    dcRef.current?.close();
    pcRef.current?.close();
    micRef.current?.getTracks().forEach((t) => t.stop());
    void audioCtxRef.current?.close();
    dcRef.current = null; pcRef.current = null; micRef.current = null; audioCtxRef.current = null;
  }

  function send(event: Json) {
    if (dcRef.current?.readyState === "open") dcRef.current.send(JSON.stringify(event));
  }

  function realtimeText(text: string) {
    send({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text }] } });
    send({ type: "response.create" });
  }

  async function save(callId: string, args: string) {
    if (savedRef.current) return;
    savedRef.current = true;
    setPhase("saving");
    let result: unknown = {};
    try { result = JSON.parse(args); } catch { /* saved with transcript only */ }
    const transcript = linesRef.current.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text);
    const response = await fetch(`/api/interview/sessions/${id}/complete`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript, result }),
    }).catch(() => null);
    const ok = response?.ok ?? false;
    const output = { type: "function_call_output", call_id: callId, output: JSON.stringify({ saved: ok }) };
    if (protocolRef.current === "live") { send({ type: "response.item.create", item: output }); send({ type: "response.create" }); }
    else { send({ type: "conversation.item.create", item: output }); send({ type: "response.create" }); }
    if (!ok) {
      savedRef.current = false;
      setPhase("live");
      setError("Couldn't save. Ask the interviewer to try again.");
      return;
    }
    setPhase("done");
    // Leave time for the closing words; research has already started on the server.
    setTimeout(() => { send({ type: "session.close" }); stop(); router.refresh(); }, 9000);
  }

  function functionCall(item: Json | undefined) {
    if (item?.type === "function_call" && item.name === SUBMIT_TOOL) void save(String(item.call_id), String(item.arguments ?? "{}"));
  }

  function handle(event: Json) {
    switch (event.type) {
      // GPT-Live
      case "session.started": send({ type: "session.commentary.append", delegation_id: null, content: GREETING }); break;
      case "session.input_transcript.delta": append("voter", String(event.delta ?? "")); break;
      case "session.output_transcript.delta": append("interviewer", String(event.delta ?? "")); break;
      case "response.event": {
        const inner = event.event as Json | undefined;
        if (inner?.type === "response.output_item.done") functionCall(inner.item as Json);
        break;
      }
      // Realtime
      case "conversation.item.input_audio_transcription.completed": append("voter", String(event.transcript ?? ""), true); break;
      case "response.output_audio_transcript.done": append("interviewer", String(event.transcript ?? ""), true); break;
      case "response.done": for (const item of ((event.response as Json | undefined)?.output ?? []) as Json[]) functionCall(item); break;
      case "error":
        console.error("interview connection", event.error);
        setError("The interviewer had a problem. If it stops responding, press Finish or try again in a minute.");
        break;
    }
  }

  /** GPT-Live needs an outgoing audio track; without a microphone, send near-silence. */
  function silentTrack(): MediaStream {
    const ctx = new AudioContext(), osc = ctx.createOscillator(), gain = ctx.createGain(), dest = ctx.createMediaStreamDestination();
    gain.gain.value = 0.0001;
    osc.connect(gain).connect(dest);
    osc.start();
    audioCtxRef.current = ctx;
    return dest.stream;
  }

  async function start() {
    setError(null);
    setPhase("connecting");
    try {
      const pc = new RTCPeerConnection();
      pcRef.current = pc;
      pc.ontrack = (e) => { if (audioRef.current) audioRef.current.srcObject = e.streams[0]; };
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); micRef.current = stream; }
      catch { setMicBlocked(true); stream = silentTrack(); }
      stream.getTracks().forEach((t) => pc.addTrack(t, stream));
      const dc = pc.createDataChannel("oai-events");
      dcRef.current = dc;
      dc.onmessage = (m) => { try { handle(JSON.parse(String(m.data)) as Json); } catch { /* ignore malformed frames */ } };
      dc.onopen = () => { setPhase("live"); if (protocolRef.current === "realtime") send({ type: "response.create" }); };

      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      const response = await fetch(`/api/interview/sessions/${id}/connect`, { method: "POST", headers: { "content-type": "application/sdp" }, body: offer.sdp });
      const answer = (await response.json()) as { sdp?: string; protocol?: Protocol; error?: { message?: string } };
      if (!response.ok || !answer.sdp) throw new ServerMessage(answer.error?.message ?? START_FAILED);
      protocolRef.current = answer.protocol ?? "live";
      await pc.setRemoteDescription({ type: "answer", sdp: answer.sdp });
    } catch (e) {
      stop();
      setPhase("error");
      if (!(e instanceof ServerMessage)) console.error("interview start", e);
      setError(e instanceof ServerMessage ? e.message : START_FAILED);
    }
  }

  function sendText() {
    const text = draft.trim();
    if (!text) return;
    append("voter", text, true);
    if (protocolRef.current === "live") {
      // GPT-Live has no text-input turn: pass the answer as context, then ask it to respond.
      send({ type: "session.thinking.append", delegation_id: null, content: `The voter typed this reply: "${text.slice(0, 1500)}"` });
      send({ type: "session.commentary.append", delegation_id: null, content: "The voter just answered by typing. Briefly acknowledge it and continue the interview." });
    } else realtimeText(text);
    setDraft("");
  }

  /** Finish: the server summarizes the transcript, so saving never depends on the voice model choosing to. */
  async function finish() {
    if (savedRef.current) return;
    savedRef.current = true;
    setPhase("saving");
    setError(null);
    if (protocolRef.current === "live") send({ type: "session.commentary.append", delegation_id: null, content: study ? FINISH_STUDY : FINISH_VOTER });
    const transcript = linesRef.current.map((l) => ({ ...l, text: l.text.trim() })).filter((l) => l.text);
    const response = await fetch(`/api/interview/sessions/${id}/complete`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ transcript, summarize: true }),
    }).catch(() => null);
    if (!response?.ok) {
      savedRef.current = false;
      setPhase("live");
      setError("Couldn't save. Try Finish again.");
      return;
    }
    setPhase("done");
    setTimeout(() => { send({ type: "session.close" }); stop(); router.refresh(); }, 8000);
  }

  function toggleMute() {
    const next = !muted;
    micRef.current?.getAudioTracks().forEach((t) => { t.enabled = !next; });
    if (protocolRef.current === "live") send({ type: next ? "session.input_audio.mute" : "session.input_audio.unmute" });
    setMuted(next);
  }

  const active = phase === "live" || phase === "saving";
  // One panel sized to the screen: the conversation scrolls inside it, and the controls stay in view below it.
  return (
    <div className="flex flex-col overflow-hidden rounded-2xl border border-border">
      <audio ref={audioRef} autoPlay className="hidden" />

      <div className="flex h-[max(18rem,calc(100dvh-24rem))] flex-col overflow-y-auto p-4 sm:p-6">
        {lines.length ? (
          <ol aria-live="polite" className="flex flex-col gap-2 text-sm leading-6">
            {lines.map((line, i) => (
              <li key={i} className={cn("max-w-[80%] rounded-2xl px-3.5 py-2", line.role === "voter" ? "self-end bg-primary text-primary-foreground" : "bg-muted")}>{line.text}</li>
            ))}
            <li ref={bottomRef} aria-hidden />
          </ol>
        ) : (
          <div className="m-auto flex max-w-sm flex-col items-center gap-4 text-center">
            {phase === "idle" || phase === "error" ? (
              <>
                <p className="text-sm text-muted-foreground">We&apos;ll ask to use your microphone. You can also type.</p>
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="lg" onClick={start}><Mic data-icon="inline-start" />{phase === "error" ? "Try again" : "Start"}</Button>
                  {phase === "error" ? <Button size="lg" variant="outline" nativeButton={false} render={<Link href="/interview" />}>Back</Button> : null}
                </div>
              </>
            ) : null}
            {phase === "connecting" ? <Button size="lg" disabled><Spinner data-icon="inline-start" />Connecting</Button> : null}
            {phase === "live" ? <p role="status" className="text-sm text-muted-foreground">Listening. Speak, or type below.</p> : null}
          </div>
        )}
      </div>

      {error || phase === "done" || active ? (
        <div className="flex flex-col gap-3 border-t border-border p-3 sm:p-4">
          {error ? <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert> : null}
          {phase === "done" ? <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Spinner />{study ? "Saved. Loading…" : "Saved. Starting your free research…"}</p> : null}
          {active ? (
            <div className="flex flex-col gap-2 sm:flex-row">
              <form onSubmit={(e) => { e.preventDefault(); sendText(); }} className="flex flex-1 gap-2">
                <Input value={draft} onChange={(e) => setDraft(e.target.value)} maxLength={1000} placeholder={micBlocked ? "No microphone. Type your answer here" : "Or type here"} aria-label="Type an answer" />
                <Button type="submit" variant="outline" size="icon" aria-label="Send"><Send /></Button>
              </form>
              <div className="flex gap-2">
                {!micBlocked ? <Button variant="outline" onClick={toggleMute}>{muted ? <MicOff data-icon="inline-start" /> : <Mic data-icon="inline-start" />}{muted ? "Unmute" : "Mute"}</Button> : null}
                <Button variant="secondary" onClick={finish} disabled={phase === "saving"}>{phase === "saving" ? <><Spinner data-icon="inline-start" />Saving</> : "Finish"}</Button>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
