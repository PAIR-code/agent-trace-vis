# Agentic traces timeline

Developer notes for `/#/agentic-traces`. Each selected trace is drawn as one
row. Time (or tokens) runs left to right. Each row has horizontal lanes
("channels"), with a files lane underneath.

## Glossary

| Word | Type | Meaning |
|---|---|---|
| trace record | `TraceRecord` (`trace.ts`) | Raw OpenTraces JSON for one agent session. |
| trace | `ReasoningTrace` | A parsed trace record: a list of steps. |
| trace entry | `TraceEntry` | One item in the trace picker: title, date, agents, and the parsed trace. |
| step | `ReasoningTraceStep` | One message in the record: a user turn, an agent turn, or a system message. |
| node | `ReasoningTraceNode` | One piece of a step: thinking, a tool call (with its result), a response… |
| mark | `Mark` | A node as drawn: its channel, position, size and look. Marks keep their node's id. |
| row / track | `TraceLayout` | Everything drawn for one selected trace: marks, backbone and files lane. |
| channel / lane | `CHANNELS` | A horizontal band in a row (user, agent, tools…). |
| thread message | `ThreadMessage` | A side-panel entry: a user or system message, or an agent turn with its marks (thinking, tools, response) nested. |
| search layer | `AnalysisLayer` | One search query with a color. Its matches glow on the timeline and in the panel. |

## How it works

```
dataset.service: dataset list (manifest.json, Hugging Face, imports) → TraceEntry[]
trace JSON ──trace-loader.service──▶ ReasoningTrace (steps → nodes)
                  tools.ts: tool name → stepType + label
                                            │
                           layoutTraces()   │  layout.ts (pure, no DOM)
                                            ▼
   x-scale.ts   time/tokens → x, idle-gap compression, ticks
   marks.ts     one Mark per node: channel, x, y, width, height, look
   backbone-builder.ts   agent line through the 'agent' channel
   file-events.ts + file-lane.ts   files lane rows and markers
                                            │
                                            ▼
                         TraceLayout[] (one per row)
                                            │
   agentic-traces.ts / .html   page: toolbar, axis, row drag-and-drop, side panel
   trace-track.ts / .html      one row: lanes, backbone, marks, files lane
```

- **Layout is pure.** `layoutTraces()` returns positioned data, and the
  components only draw it. To check a layout change, compare the layout output
  before and after the change.
- **Tools** (`tools.ts`): each tool call is classified once, by tool name,
  into a `stepType` and a display label. Everything downstream reads only the
  `stepType`: `fileAccess()` decides whether a node goes in the files lane, and
  `toolIcon()` picks its glyph. Nothing re-parses the label text.
- **Channels** (`channels.ts`): the lanes' order, labels, heights and colors all
  come from this one list. Lane backgrounds, lane labels and mark y-positions
  are derived from it.
- **Marks** (`marks.ts`): every trace node becomes exactly one `Mark`.
  `MARK_SPECS` gives each node type:
  - a channel;
  - an anchor on that channel's center line (`above` / `below` / `center` / `hang`);
  - a width and a height.

  Shape and color are CSS, keyed on the mark's `type` (see `trace-track.css`).
- **Files lane**:
  - `file-events.ts` finds which files each node viewed, searched or edited.
  - `file-lane.ts` lays out one row per file.
  - Markers reuse their node's mark x, so they line up with the main track and
    share its hover, selection and search state.
- **Search**: while a search layer is on:
  - Matched marks keep their color and get a `box-shadow` glow in the layer's
    color.
  - Everything else is grayed out.
  - Don't use per-mark CSS `filter`s (`drop-shadow`, `grayscale`). With
    hundreds of marks they make clicking noticeably laggy.

## How to add a channel

1. Add an entry to `CHANNELS` in `channels.ts` (id, label, height, background).
   The track height, lane backgrounds and labels update automatically.
2. Point node types at it in `MARK_SPECS` in `marks.ts`. If it needs a new node
   type, add the type to `TraceNodeType` in `layout-types.ts` and create those
   nodes in `trace-loader.service.ts`.
3. Style the new type in `trace-track.css` (`.vis-node.<type>`).

## How to add a mark type to an existing channel

Add a `TraceNodeType`, a `MARK_SPECS` entry, and a `.vis-node.<type>` rule.

## How to support new tool names

Agent harnesses name their tools differently (`view_file`, `read_file`, `cat`…).
Add the new name to the matching entry in `TOOLS` in `tools.ts`. Entries are
checked in order and the first match wins. A tool that matches nothing is
`GENERIC`: it is drawn in the tools channel with its name as the label.
