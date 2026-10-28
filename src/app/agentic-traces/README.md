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
  the response follow in order, one icon apart, at its right edge. If that
  would run past the next step's start (e.g. zoomed out), the icons are
  squeezed together so marks stay in time order.
- **Hidden marks.** File views, edits and searches have marks with
  `hidden: true`: they're drawn in the files lane, which reuses the mark's x
  and id. Rate-limit retry messages get an invisible zero-size mark.
- Nodes never change after parsing. Marks are rebuilt on every layout (resize,
  time/tokens toggle, …).

## How it works

```
dataset.service: dataset list (manifest.json, Hugging Face, imports) → TraceEntry[]
trace JSON ──trace-loader.service──▶ ReasoningTrace (steps → nodes)
                  tool_kinds → normalized kind → stepType + label
                                            │
                           layoutTraces()   │  layout.ts (pure, no DOM)
                                            ▼
   x-scale.ts   time/tokens → x, user-wait gap compression, ticks
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
- **Tools** (`tools.ts`): each tool call's kind comes first from
  `metadata.tool_kinds`, keyed by its original `tool_name`. If it is absent or
  invalid, the loader makes a best-effort inference from the name. The resolved
  kind maps to a `stepType` and display label; downstream rendering reads only
  the `stepType`: `fileAccess()` decides whether a node goes in the files lane,
  and `toolIcon()` picks its glyph. Nothing re-parses the label text.
  Files written as a side effect (a URL fetch's saved page, or shell output
  via redirects, `tee`, Python `open(.., 'w')`, `curl -o/-O`) also appear in the
  files lane as writes, while the tool's mark stays in the tools lane; see
  `extractIndirectWrites()` in `file-events.ts`.
- **Channels** (`channels.ts`): the lanes' order, labels, heights and colors all
  come from this one list. Lane backgrounds, lane labels and mark y-positions
  are derived from it.
- **X axis** (`AxisMode` in `layout-types.ts`): `time` (elapsed ms), `tokens`
  (cumulative token usage, or word count where usage is missing) or `sequence`
  (one slot per node, shown as "Steps" in the toolbar). All selected groups
  share one scale, so the longest fills the width. Time needs timestamps:
  while no selected trace has any, the Time button is disabled and the layout
  uses `sequence` instead (`effectiveAxisMode` in `agentic-traces.ts`); the
  user's choice is remembered and comes back when a timestamped trace is
  selected. `layoutTraces()` always receives the resolved mode.
- **Row expansion**: by default a row shows its channel lanes plus the files
  lane; `collapse` (per row, or `Collapse all` in the toolbar) folds it into one
  lane with every mark and file marker on a single center line. Both are purely
  presentational: a mark's `y` is an offset from its channel's center, so
  `collapsedY()` re-applies that offset to the shared line and the backbone is
  translated to match. Layout is not re-run.
- **Unused channels are skipped**: a row only draws the channels that have a
  mark in it (plus `agent`, where the backbone runs; see `usedChannels` /
  `laneGeometry` in `channels.ts`). Marks are still laid out against the full
  channel set, and `trace-track` shifts them to the row's own lane centers the
  same way collapsing does. The page uses the same geometry for row heights.
- **Marks** (`marks.ts`): every trace node becomes exactly one `Mark`.
  `MARK_SPECS` gives each node type:
  - a channel;
  - an anchor on that channel's center line (`above` / `below` / `center` / `hang`);
  - a width and a height. Width is either a fixed icon size or `'extent'`: a
    rectangle (dialogue, reasoning, file edits, artifacts) exactly as long as
    the node on the axis — its time range, its share of the step's tokens, or
    its slot. All rectangles go through the same code path; icons instead show
    a measured extent as a thin `span` bar.

  Shape and color are CSS, keyed on the mark's `type` (see `trace-track.css`).
- **Files lane**:
  - `file-events.ts` finds which files each node viewed, searched or edited.
  - `file-lane.ts` lays out one row per file.
  - Markers reuse their node's mark x, so they line up with the main track and
    share its hover, selection and search state.
  - **Artifacts** are the agent's own plan / scratch files: a path under the
    trace's `metadata.artifact_dirs` (the Jetski converter emits the
    conversation's brain dir), or a write with an explicit `ArtifactMetadata` /
    `IsArtifact` flag. Exact signals only; the filename-based `isPlan` is not
    used for this. A file tool whose files are all artifacts is left out of the
    files lane and drawn in the `artifacts` channel instead, as a white edit bar
    with the files lane's sizing (`ARTIFACT_SPEC` in `marks.ts`).
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
- **Multi-agent traces** (`agent-groups.ts`, `links.ts`): traces that belong
  together form a *group*, which shares one axis and moves as one. A group
  comes in two shapes:
  - **Subagents (a tree)**: a trace launched by another trace's tool call (an
    `invoke_subagent`) records its parent in `metadata.parent_trace_id` /
    `parent_tool_call_id`; the parent's tool call lists its children in
    `subagent_refs` (both written by `convert_jetski_db.py`). Subagent rows
    are titled `[subagent] …` (`TraceLayout.depth`). In time mode a
    subagent's row starts under the moment it was launched; in tokens mode it
    is offset to the parent's token count at the launching step.
  - **Teams (flat)**: peer agents working on one task (e.g.
    `converters/convert_swarm_team.py`). Each member's trace carries
    `metadata.team` (team id, members, this agent). Every member is a root
    (depth 0), in member order, with its own palette color
    (`teamMemberColor` in `colors.ts`): members usually share a model, so
    model colors would make them alike.
  - `linkGroups()` resolves parents and teams when a dataset loads.
    Selecting a trace selects its group, and the selection is kept in *group
    order* (`groupOrder()`), so a group's rows are adjacent. Each row records
    its group (`TraceLayout.groupId`); dragging a row moves its whole group,
    and rows can only be dropped between groups.
  - Gaps represent periods waiting for user input. They are found over the
    whole group (`buildGroups()` in `layout.ts`), so a parent waiting on a
    subagent is not "waiting for user" and gap compression doesn't squash the
    subagent's work. By default, user wait gaps are hidden (compressed);
    toggling "Show user wait" expands them. Fill-space stretches the group,
    not each row.
  - **Messages** between agents, in either shape, come from
    `metadata.agent_messages`: the ids each trace sent and received, by tool
    call or by `step:<index>` (see `AgentMessages` in
    `trace-extensions.ts`). The loader attaches them to marks
    (`Mark.messages`). Message tools (`message.send` / `message.receive`
    kinds) are drawn in the `artifacts` channel, which a row with messages
    labels "messages" (`laneLabel` in `trace-track.ts`): a filled diamond for
    a send, an outlined circle for a read or wait. A message received by a
    harness notice (Antigravity's `[Message] …` system messages) ends on that
    notice's mark.
  - `buildLinks()` in `links.ts` draws every line between rows, in one SVG
    over the row stack: a subagent's *launch* (a dot on the parent's agent
    line at the launching tool call, whose mark is hidden, down to the
    subagent's agent line); a *message* curve from each send to each receipt;
    and an *unread* stub (fine dashes, hollow end) from a send to each shown
    recipient that never received it. Hovering or selecting a message mark
    highlights its lines. Only time mode is shared across rows; in tokens and
    steps mode each row has its own axis, so a receipt can sit left of its
    send: those lines are dashed and leave vertically (`curve()`).

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
