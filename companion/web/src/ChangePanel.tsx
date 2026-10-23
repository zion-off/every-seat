import type { Settings, ToolCall } from "./api";

const WORDS: Record<keyof Settings, [string, Record<string, string>]> = {
  flashes: ["Flashing", { soften: "Dimmed", off: "As is" }],
  loud: ["Loud sound", { cap: "Quieter", off: "As is" }],
  scares: ["Scares", { headsup: "Heads-up first", off: "As is" }],
  ad: ["Audio description", { on: "On", off: "Off" }],
};

interface Person {
  name: string;
  settings: Settings;
}

interface LensOutput {
  people?: Person[];
  settings?: Settings;
  tvConnected?: boolean;
  name?: string;
  created?: boolean;
  summary?: string;
}

function Chips({ settings }: { settings: Settings }) {
  return (
    <ul className="chips">
      {(Object.keys(WORDS) as (keyof Settings)[]).map((key) => {
        const [label, values] = WORDS[key];
        const value = settings[key];
        const on = value !== "off";
        return (
          <li key={key} className={on ? "chip on" : "chip"}>
            <span className="chip-label">{label}</span>
            <span className="chip-value">{values[value] ?? value}</span>
          </li>
        );
      })}
    </ul>
  );
}

function outputOf(call: ToolCall): LensOutput {
  return (call.result.structuredContent ?? {}) as LensOutput;
}

/** Whether a tool result has something to show besides the spoken reply. */
export function hasPanel(call: ToolCall): boolean {
  const output = outputOf(call);
  if (call.result.isError || !output.settings) return false;
  if (call.name === "set_tonight_lens") return output.people !== undefined;
  return call.name === "remember_preference" && output.name !== undefined;
}

/** Shows what a lens or preference change did, in the same terms the TV uses. */
export function ChangePanel({ call }: { call: ToolCall }) {
  const output = outputOf(call);
  if (!hasPanel(call)) return null;

  if (call.name === "set_tonight_lens" && output.people && output.settings) {
    return (
      <section className="panel" aria-label="Tonight's couch">
        <p className="eyebrow">Tonight's couch</p>
        <ul className="people">
          {output.people.map((person) => (
            <li key={person.name}>
              <span className="avatar" aria-hidden="true">
                {person.name.slice(0, 1).toUpperCase()}
              </span>
              {person.name}
            </li>
          ))}
        </ul>
        <p className="status" data-connected={output.tvConnected ? "yes" : "no"}>
          {output.tvConnected ? "✓ TV updated" : "TV not connected"}
        </p>
        <p className="eyebrow">Applied on the TV</p>
        <Chips settings={output.settings} />
      </section>
    );
  }

  if (call.name === "remember_preference" && output.name && output.settings) {
    return (
      <section className="panel" aria-label="Saved settings">
        <p className="eyebrow">Saved for every night</p>
        <ul className="people">
          <li>
            <span className="avatar" aria-hidden="true">
              {output.name.slice(0, 1).toUpperCase()}
            </span>
            {output.name}
          </li>
        </ul>
        <Chips settings={output.settings} />
      </section>
    );
  }

  return null;
}
