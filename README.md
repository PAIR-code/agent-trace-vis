# Agent Trace Vis

[Live Demo](https://agent-trace-vis.netlify.app)

A timeline visualization for understanding AI agent traces. Built for researchers, engineers, and anyone trying to make sense of complex agentic behaviors.

As AI systems increasingly rely on multi-step reasoning and tool use, understanding what they actually do, and why, becomes critical. But most of this behavior is hidden: the implementation steps, tool calls, backtracking, and decision points that shape the final output. Agent Trace Vis makes these patterns legible. Each trace is one row with horizontal lanes: the user/agent conversation, the agent's internal processes (thinking), tool calls, and a files lane showing which files were read, searched, and edited. It supports comparing traces side by side, subagents and multi-agent teams, search, model highlighting, and gap compression for long traces.

Traces are JSON files following the [OpenTraces](https://www.opentraces.ai) schema.

## Getting Started

### 1. Run locally
```bash
npm install
npm start
```
The app runs at `http://localhost:4200` and opens with the bundled sample traces.

### 2. Bring your own traces

The app reads [OpenTraces](https://www.opentraces.ai) JSON. To look at your own agent's traces, convert them with (or adapt) one of the converters in [`converters/`](converters/); see [`converters/README.md`](converters/README.md) for converting GitHub Copilot sessions and multi-agent team rollouts, and for how to write a converter for another agent.

Then either:

- **Open them in the app:** use **+ Add dataset → Open local files…** in the examples sidebar, or drop `.json` / `.jsonl` files on it. Files are parsed in your browser and never uploaded; they're kept in the browser (IndexedDB) until you remove the dataset.
- **Add them to the project's datasets:** put them in `data/local/traces/<dataset>/`, which `npm start` serves.

```
agent-trace-vis/
├── testdata/            ← sample datasets, committed
└── data/
    └── local/           ← your own traces (gitignored)
        └── traces/      ← one folder per dataset
```
Each sub-folder becomes one dataset in the sidebar; a folder with the same name in both `testdata/` and `data/local/traces/` is merged. Converters write to `data/local/traces/` by default.

Before each start/build, `generate-manifest.js` copies the datasets into `.data-build/` (gitignored; served at `testdata/`) and writes the manifest. `npm start` gets every dataset. Builds and deploys get only the selected ones (below), in a separate folder, so deploying never changes what you see locally.

#### The examples sidebar

Every dataset you load gets a section in the sidebar listing its traces. Select several, within or across datasets, to compare them as rows on the timeline; **Only** selects just one, and the pencil renames a trace (kept in your browser). The workspace is in the URL (`?ds=<source>:<dataset>:<indices>`), so you can share what you're looking at.

To load datasets from somewhere else (e.g. your own server), implement `TraceSource` in [`src/app/data/trace-source.ts`](src/app/data/trace-source.ts) and register it with the `TRACE_SOURCES` provider in [`src/app/app.config.ts`](src/app/app.config.ts).

### 3. Build and deploy (Netlify)

Building compiles the app locally to `dist/reasoning-trace-vis/browser/`. Deploying uploads those files to Netlify at [agent-trace-vis.netlify.app](https://agent-trace-vis.netlify.app).

By default a build includes only the public datasets (`PUBLIC_DATASETS` in `generate-manifest.js`). Pass `DATASETS` (comma-separated, or `all`) to choose others; a name that doesn't exist fails the build.

```bash
npm run deploy                                   # production, public datasets
npm run deploy:draft                             # preview URL, public datasets
DATASETS=my_traces npm run deploy:draft          # preview URL, chosen datasets
```

## Trace format

Each trace file should follow this structure:

```json
{
  "schema_version": "0.7.0",
  "trace_id": "unique-id",
  "session_id": "session-id",
  "task": {
    "description": "Human-readable title"
  },
  "steps": [
    {
      "role": "user",
      "content": "User message text",
      "timestamp": "2024-01-01T00:00:00Z"
    },
    {
      "role": "agent",
      "model": "model-name",
      "reasoning_content": "Internal thinking...",
      "content": "Response to user",
      "tool_calls": [
        {
          "tool_call_id": "tc_0",
          "tool_name": "view_file",
          "input": { "AbsolutePath": "/path/to/file" }
        }
      ],
      "observations": [
        {
          "source_call_id": "tc_0",
          "content": "File contents..."
        }
      ],
      "timestamp": "2024-01-01T00:00:01Z"
    }
  ]
}
```

## License and Disclaimer

All software is licensed under the Apache License, Version 2.0 (Apache 2.0).
You may not use this file except in compliance with the Apache 2.0 license.
You may obtain a copy of the Apache 2.0 license at:
https://www.apache.org/licenses/LICENSE-2.0.

Unless required by applicable law or agreed to in writing, all software and
materials distributed here under the Apache 2.0 licenses are distributed on an
"AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or
implied. See the licenses for the specific language governing permissions and
limitations under those licenses.

This is not an official Google product.
