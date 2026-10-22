import { AppRenderer } from "@mcp-ui/client";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { connectMcp, converse, loadConfig, type PageConfig, type ToolCall, type Turn } from "./api";
import { ChangePanel, hasPanel } from "./ChangePanel";
import { canListen, canSpeak, speak, stopSpeaking, usePushToTalk } from "./speech";

interface Entry extends Turn {
  id: number;
  calls: ToolCall[];
}

function hasCard(call: ToolCall): boolean {
  const ui = (call.result._meta as { ui?: { resourceUri?: unknown } } | undefined)?.ui;
  return typeof ui?.resourceUri === "string";
}

function Card({ client, config, call }: { client: Client; config: PageConfig; call: ToolCall }) {
  const [problem, setProblem] = useState<string | null>(null);
  // The card runs on its own origin (a different port) so it can't reach this page.
  const sandbox = useMemo(
    () => ({ url: new URL(`${window.location.protocol}//${window.location.hostname}:${config.sandboxPort}/sandbox.html`) }),
    [config.sandboxPort],
  );
  const onError = useCallback((error: Error) => setProblem(error.message), []);
  const onOpenLink = useCallback(async () => ({ isError: true }), []);
  const onMessage = useCallback(async () => ({ isError: true }), []);

  return (
    <section className="card" aria-label="Comfort check">
      {problem && <p className="error">The card couldn't be shown: {problem}</p>}
      <AppRenderer
        client={client}
        toolName={call.name}
        sandbox={sandbox}
        toolInput={call.arguments}
        toolResult={call.result}
        onError={onError}
        onOpenLink={onOpenLink}
        onMessage={onMessage}
      />
    </section>
  );
}

export function App() {
  const [config, setConfig] = useState<PageConfig | null>(null);
  const [client, setClient] = useState<Client | null>(null);
  const [setup, setSetup] = useState<string | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [muted, setMuted] = useState(false);
  const nextId = useRef(1);
  const transcript = useRef<HTMLOListElement>(null);
  const history = useRef<Turn[]>([]);
  const mutedNow = useRef(muted);

  useEffect(() => {
    mutedNow.current = muted;
    if (muted) stopSpeaking();
  }, [muted]);

  useEffect(() => {
    let live = true;
    let opened: Client | null = null;
    (async () => {
      try {
        const loaded = await loadConfig();
        const connected = await connectMcp();
        opened = connected;
        if (!live) {
          void connected.close();
          return;
        }
        setConfig(loaded);
        setClient(connected);
      } catch (error) {
        const message = error instanceof Error ? error.message : "";
        if (live) {
          setSetup(
            /unauthorized/i.test(message)
              ? "This companion needs a key. Open the page with ?key=… added to the address."
              : message || "The companion isn't reachable.",
          );
        }
      }
    })();
    return () => {
      live = false;
      void opened?.close();
    };
  }, []);

  useEffect(() => {
    transcript.current?.scrollTo({ top: transcript.current.scrollHeight, behavior: "smooth" });
  }, [entries, busy]);

  const send = useCallback(
    async (text: string) => {
      const message = text.trim();
      if (!message || busy) return;
      setFailure(null);
      setBusy(true);
      setEntries((current) => [...current, { id: nextId.current++, role: "user", text: message, calls: [] }]);
      try {
        const answer = await converse(message, history.current);
        const exchange: Turn[] = [
          { role: "user", text: message },
          { role: "assistant", text: answer.reply },
        ];
        history.current = [...history.current, ...exchange].slice(-20);
        setEntries((current) => [
          ...current,
          { id: nextId.current++, role: "assistant", text: answer.reply, calls: answer.toolCalls },
        ]);
        if (!mutedNow.current) speak(answer.reply);
      } catch (error) {
        setFailure(error instanceof Error ? error.message : "Something went wrong. Try again.");
      } finally {
        setBusy(false);
      }
    },
    [busy],
  );

  const talk = usePushToTalk(send);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const text = draft;
    setDraft("");
    void send(text);
  };

  const latest = [...entries].reverse().find((entry) => entry.role === "assistant");
  const calls = latest?.calls ?? [];
  const cardCall = calls.find(hasCard);
  const changes = calls.filter(hasPanel);

  return (
    <div className="screen">
      <header className="top">
        <span className="badge">Simulated Alexa+ add-on</span>
        <span className="household">{config ? `Household: ${config.household}` : ""}</span>
      </header>

      <main className="body">
        <section className="talk" aria-label="Conversation">
          {entries.length === 0 && !setup && (
            <p className="hint">
              Try “Is Tears of Steel okay for Leo tonight?” or “Heads-ups, but don't skip anything.”
            </p>
          )}
          {setup && <p className="error">{setup}</p>}
          <ol ref={transcript} className="transcript">
            {entries.map((entry) => (
              <li key={entry.id} className={`line ${entry.role}`}>
                {entry.text}
              </li>
            ))}
            {talk.heard && <li className="line user live">{talk.heard}</li>}
            {busy && <li className="line assistant thinking">Working on it…</li>}
          </ol>
          {(failure ?? talk.problem) && <p className="error">{failure ?? talk.problem}</p>}
        </section>

        <section className="stage" aria-label="Result">
          {client && config && cardCall && <Card key={latest?.id} client={client} config={config} call={cardCall} />}
          {changes.map((call, index) => (
            <ChangePanel key={`${latest?.id}-${index}`} call={call} />
          ))}
          {!cardCall && changes.length === 0 && <p className="idle">Ask about a film, or tell me who's on the couch tonight.</p>}
        </section>
      </main>

      <form className="bar" onSubmit={submit}>
        {canListen && (
          <button
            type="button"
            className={talk.listening ? "mic live" : "mic"}
            aria-label="Hold to talk"
            aria-pressed={talk.listening}
            disabled={!client || busy}
            onPointerDown={talk.start}
            onPointerUp={talk.stop}
            onPointerLeave={talk.stop}
            onKeyDown={(event) => {
              if ((event.key === " " || event.key === "Enter") && !event.repeat) {
                event.preventDefault();
                talk.start();
              }
            }}
            onKeyUp={(event) => {
              if (event.key === " " || event.key === "Enter") talk.stop();
            }}
          >
            {talk.listening ? "Listening…" : "Hold to talk"}
          </button>
        )}
        <input
          className="text"
          type="text"
          value={draft}
          maxLength={1000}
          placeholder={canListen ? "Or type here" : "Type here"}
          aria-label="Type a request"
          disabled={!client || busy}
          onChange={(event) => setDraft(event.target.value)}
        />
        <button type="submit" className="send" disabled={!client || busy || draft.trim() === ""}>
          Send
        </button>
        {canSpeak && (
          <button type="button" className="mute" aria-pressed={muted} onClick={() => setMuted((value) => !value)}>
            {muted ? "Voice off" : "Voice on"}
          </button>
        )}
      </form>
    </div>
  );
}
