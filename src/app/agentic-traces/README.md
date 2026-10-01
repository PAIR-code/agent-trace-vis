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

### Steps, nodes and marks

```
TraceRecord.steps[i]   raw JSON
      │  trace-loader.service: parseStep()      one step → one or more nodes
      ▼
ReasoningTraceStep     one message: user turn, agent turn, or system message
  └─ nodes: ReasoningTraceNode[]
      │  marks.ts: buildMarks()                 one node → exactly one mark (same id)
      ▼
Mark                   the node as drawn: channel, x, y, width, height, look
  └─ stepRef ──▶ its ReasoningTraceStep
```

- **Step → nodes.** A user step becomes one `USER_INPUT` node, and a system
  step one `SYSTEM` node. An agent step becomes, in order: a `THINKING` node
  (if it has reasoning text), one node per tool call (`TOOL_DATA` if the result
  came back, else `TOOL_CALL`), and a `RESPONSE` node (if it has reply text).
- **What lives where.** The step holds what its nodes share: timestamp, model,
  agent, token usage and color. A node holds its own type, text, `stepType`
  (the tool kind, from `tools.ts`) and raw `data` (the tool call and result).
- **Node → mark.** Every node gets exactly one mark with the same `id`, so the
  side panel, search and files lane all refer to it by id. The mark copies the
  node's fields and adds geometry. `stepRef` points back to the step: the step's
  time or token range places the mark, its token usage sizes it, and the side
  panel uses it to group an agent turn.
- **Within a step** the data has the order of events but not their times (all
  nodes carry the step's timestamp). Reasoning spans the step; tool calls and
  the response follow in order, one icon apart, at its right edge.
- **Hidden marks.** File views, edits and searches have marks with
  `hidden: true`: they're drawn in the files lane, which reuses the mark's x
  and id. Rate-limit retry messages get an invisible zero-size mark.
- Nodes never change after parsing. Marks are rebuilt on every layout (resize,
  time/tokens toggle, …).

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
  - In the side panel, only the matched text is highlighted, in the layer's
    color (`viewer-helpers.ts`).
  - Don't use per-mark CSS `filter`s (`drop-shadow`, `grayscale`). With
    hundreds of marks they make clicking noticeably laggy.
- **Scrub bar** (`scrub-bar.ts`): a playhead over the active row (lanes and
  files). Press anywhere on a row to make it active and scrub from there.
  Over a mark (`markAt()`), it selects it and the side panel jumps to it. In a
  gap, nothing is selected and the side panel scrolls the next mark to the top
  (`scrollTarget`). The side panel never smooth-scrolls; it jumps. Rows are
  reordered by the grip at their right end.

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
