# Reasoning Trace Visualization

[Live Demo](https://agent-trace-vis.netlify.app)

Visual tools for understanding AI agent reasoning traces. Built for researchers, engineers, and anyone trying to make sense of complex agentic behaviors.

As AI systems increasingly rely on multi-step reasoning and tool use, understanding what they actually do, and why, becomes critical. But most of this behavior is hidden: the implementation steps, tool calls, backtracking, and decision points that shape the final output. This project explores visual approaches to making these patterns legible, from structured agentic traces (where agents coordinate tools, sub-agents, and user interactions) to unstructured chain-of-thought reasoning (where we want to compare strategies across multiple rollouts of the same task). Our goal is to bridge the gap between deep-reading a single trace and aggregate metrics across thousands, supporting the mesoscale analysis needed to form and test hypotheses about how these systems behave.

## Visualizations

### Agentic Traces
A timeline-based visualization for structured agent traces (e.g., from coding agents, tool-using LLMs). Each trace is one row with horizontal lanes: the user/agent conversation, the agent's internal processes (thinking), tool calls, and a files lane showing which files were read, searched, and edited. Supports search, model highlighting, and gap compression for long traces.

- **Demo**: [Demo](https://agent-trace-vis.netlify.app/#/agentic-traces)
- **Route**: `/#/agentic-traces`
- **Data format**: JSON files following the [OpenTraces](https://www.opentraces.ai) schema

#### Bringing your own traces

The repo ships with sample traces in [`data/sample/traces/`](data/sample/traces/) (GitHub Copilot agent-mode sessions and a website-editing session), so `npm start` shows real data right away. To look at your own agent's traces you need them as OpenTraces JSON; the easiest path is to use (or adapt) one of the converters in [`converters/`](converters/). See [`converters/README.md`](converters/README.md) for how to convert your Copilot chats and how to write a converter for another agent.

### Unstructured Reasoning (Graph)
A force-directed graph visualization for comparing multiple rollouts of unstructured chain-of-thought reasoning (e.g., RLVR-trained models solving math problems). Segments reasoning into chunks, embeds them, and visualizes structural patterns across traces.

- **Demo**: [Demo](https://agent-trace-vis.netlify.app/#/unstructured-reasoning-graph)
- **Route**: `/#/unstructured-reasoning-graph`
- **Data format**: JSON arrays of reasoning samples with `reasoning_content` and `score` fields

### Unstructured Reasoning (Linear)
A linear token-level visualization for comparing reasoning traces across datasets. Highlights token frequency and overlap across rollouts with multiple coloring schemes (chromogram, dataset, score-based).

- **Demo**: [Demo](https://agent-trace-vis.netlify.app/#/unstructured-reasoning-linear)
- **Route**: `/#/unstructured-reasoning-linear`
- **Data format**: Same as the graph view

### Conversational Arcs
A sentence-level visualization for analyzing how messages in multi-turn conversations reference and build upon previous turns.

- **Demo**: [Demo](https://agent-trace-vis.netlify.app/#/conversation-arcs)
- **Route**: `/#/conversation-arcs`

## Getting Started

### 1. Setup & Run Locally
```bash
npm install
npm start
```
The app will run at `http://localhost:4200`.

### 2. Where trace data lives
```
agent-trace-vis/
└── data/
    ├── sample/traces/      ← small sample datasets, committed
    └── local/              ← your own traces and scripts (gitignored)
        └── traces/         ← one folder per dataset
```
Each sub-folder of `traces/` becomes one dataset in the UI; a folder with the same name in both `sample/` and `local/` is merged. Converters write to `data/local/traces/` by default.

Before each start/build, `generate-manifest.js` copies the datasets into `.data-build/` (gitignored; served at `assets/data/`) and writes the manifest. `npm start` gets every dataset. Builds and deploys get only the selected ones (below), in a separate folder, so deploying never changes what you see locally.

### 3. Building & Deploying (Netlify)

Building compiles the app locally to `dist/reasoning-trace-vis/browser/`. Deploying uploads those files to Netlify at [agent-trace-vis.netlify.app](https://agent-trace-vis.netlify.app).

By default a build includes only the public datasets (`PUBLIC_DATASETS` in `generate-manifest.js`). Pass `DATASETS` (comma-separated, or `all`) to choose others; a name that doesn't exist fails the build.

```bash
npm run deploy                                   # production, public datasets
npm run deploy:draft                             # preview URL, public datasets
DATASETS=ridge_eval npm run deploy:draft         # preview URL, chosen datasets
DATASETS=ridge_eval npm run deploy:draft -- --alias ridge   # with a custom alias
```

### 4. Trace format

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

### Unstructured Reasoning Data

1. Place your JSON dataset files in the sibling `reasoning_vis_data/rlvr_vs_base/` directory.
2. Update the `datasets` array in `src/app/unstructured-traces/unstructured-reasoning-graph/unstructured-reasoning-graph.ts`

Each dataset file should be a JSON array of objects with at minimum:

```json
[
  {
    "reasoning_content": "Let me think about this step by step...",
    "score": 1,
    "problem": "What is 2+2?"
  }
]
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
