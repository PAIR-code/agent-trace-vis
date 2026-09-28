# Agentic traces timeline

Developer notes for `/#/agentic-traces`. Each selected trace is drawn as one
row. Time (or tokens) runs left to right. Each row has horizontal lanes
("channels"), with a files lane underneath.

## How it works

```
trace JSON ──trace-loader.service──▶ ReasoningTrace (steps → nodes)
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
