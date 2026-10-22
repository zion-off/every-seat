import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

export interface Settings {
  flashes: "soften" | "off";
  loud: "cap" | "off";
  scares: "headsup" | "off";
  ad: "on" | "off";
}

export interface ToolCall {
  name: string;
  arguments: Record<string, unknown>;
  result: CallToolResult;
}

export interface ConverseReply {
  reply: string;
  toolCalls: ToolCall[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number; modelCalls: number };
  model: string;
  latencyMs: number;
}

export interface PageConfig {
  household: string;
  sandboxPort: number;
  keyRequired: boolean;
}

export interface Turn {
  role: "user" | "assistant";
  text: string;
}

// An optional key arrives as ?key=… and is kept in memory only.
const params = new URLSearchParams(window.location.search);
const apiKey = params.get("key") ?? undefined;
if (apiKey !== undefined) {
  params.delete("key");
  const rest = params.toString();
  window.history.replaceState(null, "", window.location.pathname + (rest ? `?${rest}` : ""));
}

function authHeaders(): Record<string, string> {
  return apiKey === undefined ? {} : { "x-api-key": apiKey };
}

async function readJson<T>(response: Response): Promise<T> {
  const body: unknown = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

export async function loadConfig(): Promise<PageConfig> {
  return readJson<PageConfig>(await fetch("/api/config"));
}

export async function converse(message: string, history: Turn[]): Promise<ConverseReply> {
  const response = await fetch("/converse", {
    method: "POST",
    headers: { "content-type": "application/json", ...authHeaders() },
    body: JSON.stringify({ message, history: history.slice(-20) }),
  });
  return readJson<ConverseReply>(response);
}

/** The MCP connection the card uses to read its resource and call tools. */
export async function connectMcp(): Promise<Client> {
  const client = new Client({ name: "every-seat-companion-page", version: "0.1.0" });
  const url = new URL("/mcp", window.location.origin);
  await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: authHeaders() } }));
  return client;
}
