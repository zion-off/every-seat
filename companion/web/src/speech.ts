import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionResult {
  readonly 0: { readonly transcript: string };
  readonly isFinal: boolean;
}

interface RecognitionEvent {
  readonly results: ArrayLike<RecognitionResult>;
}

interface Recognition {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  maxAlternatives: number;
  onresult: ((event: RecognitionEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

type RecognitionConstructor = new () => Recognition;

function recognitionConstructor(): RecognitionConstructor | undefined {
  const scope = window as unknown as {
    SpeechRecognition?: RecognitionConstructor;
    webkitSpeechRecognition?: RecognitionConstructor;
  };
  return scope.SpeechRecognition ?? scope.webkitSpeechRecognition;
}

export const canListen = recognitionConstructor() !== undefined;
export const canSpeak = "speechSynthesis" in window;

const MESSAGES: Record<string, string> = {
  "not-allowed": "Microphone access was blocked. You can type instead.",
  "service-not-allowed": "Speech recognition isn't available here. You can type instead.",
  "no-speech": "I didn't catch that. Try again, or type it.",
  "audio-capture": "No microphone was found. You can type instead.",
  network: "Speech recognition couldn't reach its service. You can type instead.",
};

/** Push-to-talk: listening runs while the button is held and ends with one final transcript. */
export function usePushToTalk(onTranscript: (text: string) => void) {
  const [listening, setListening] = useState(false);
  const [heard, setHeard] = useState("");
  const [problem, setProblem] = useState<string | null>(null);
  const active = useRef<Recognition | null>(null);
  const transcript = useRef("");
  const deliver = useRef(onTranscript);

  useEffect(() => {
    deliver.current = onTranscript;
  }, [onTranscript]);

  const start = useCallback(() => {
    const Recognizer = recognitionConstructor();
    if (!Recognizer || active.current) return;
    if (canSpeak) window.speechSynthesis.cancel();
    const recognition = new Recognizer();
    recognition.lang = "en-US";
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    transcript.current = "";
    recognition.onresult = (event) => {
      const text = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join(" ")
        .trim();
      transcript.current = text;
      setHeard(text);
    };
    recognition.onerror = (event) => {
      if (event.error !== "aborted") setProblem(MESSAGES[event.error] ?? "Speech recognition stopped. You can type instead.");
    };
    recognition.onend = () => {
      active.current = null;
      setListening(false);
      setHeard("");
      const text = transcript.current.trim();
      transcript.current = "";
      if (text) deliver.current(text);
    };
    active.current = recognition;
    setProblem(null);
    setListening(true);
    try {
      recognition.start();
    } catch {
      active.current = null;
      setListening(false);
    }
  }, []);

  const stop = useCallback(() => {
    active.current?.stop();
  }, []);

  useEffect(() => () => active.current?.stop(), []);

  return { listening, heard, problem, start, stop };
}

/** Speaks a reply aloud, replacing anything still being spoken. */
export function speak(text: string) {
  if (!canSpeak) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = "en-US";
  utterance.rate = 1;
  window.speechSynthesis.speak(utterance);
}

export function stopSpeaking() {
  if (canSpeak) window.speechSynthesis.cancel();
}
