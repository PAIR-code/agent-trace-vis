# Reasoning Trace Visualization

Visual tools for understanding AI agent reasoning traces. Built for researchers, engineers, and anyone trying to make sense of complex agentic behaviors.

As AI systems increasingly rely on multi-step reasoning and tool use, understanding what they actually do, and why, becomes critical. But most of this behavior is hidden: the implementation steps, tool calls, backtracking, and decision points that shape the final output. This project explores visual approaches to making these patterns legible, from structured agentic traces (where agents coordinate tools, sub-agents, and user interactions) to unstructured chain-of-thought reasoning (where we want to compare strategies across multiple rollouts of the same task). Our goal is to bridge the gap between deep-reading a single trace and aggregate metrics across thousands, supporting the mesoscale analysis needed to form and test hypotheses about how these systems behave.

## Visualizations

### Agentic Traces
A timeline-based visualization for structured agent traces (e.g., from coding agents, tool-using LLMs). Shows the interplay between user messages, model thinking, tool calls, and observations in a multi-column layout. Supports search, model highlighting, and gap compression for long traces.

- **Route**: `/agentic-traces/:id`
- **Data format**: JSON files following the [OpenTraces](https://www.opentraces.ai) schema

### Unstructured Reasoning (Graph)
A force-directed graph visualization for comparing multiple rollouts of unstructured chain-of-thought reasoning (e.g., RLVR-trained models solving math problems). Segments reasoning into chunks, embeds them, and visualizes structural patterns across traces.

- **Route**: `/unstructured-reasoning-graph`
- **Data format**: JSON arrays of reasoning samples with `reasoning_content` and `score` fields

### Unstructured Reasoning (Linear)
A linear token-level visualization for comparing reasoning traces across datasets. Highlights token frequency and overlap across rollouts with multiple coloring schemes (chromogram, dataset, score-based).

- **Route**: `/unstructured-reasoning-linear`
- **Data format**: Same as the graph view

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) (v18+)
- npm (comes with Node.js)

### Setup

```bash
npm install
npm start
```

The app will be available at `http://localhost:4200`.

## Adding Your Own Data

This repo ships without data for security reasons. By default, the app is configured to load data from a sibling directory (`../reasoning_vis_data/`) which is mapped to `assets/data/` in `angular.json`.

The expected directory layout is:

```
parent/
├── reasoning_vis/          ← this app
└── reasoning_vis_data/     ← your data
    ├── traces/             ← agentic trace JSON files
    └── rlvr_vs_base/       ← unstructured reasoning datasets
```

### Agentic Traces

1. Place your JSON trace files in the sibling `reasoning_vis_data/traces/` directory.
2. The trace files will be dynamically detected. Starting the dev server (`npm start`) or compiling the project (`npm run build`) automatically triggers a script that lists the trace files in a generated `manifest.json` file.
   * If you've manually added trace files while the server is not running or want to update the manifest manually, you can run:
     ```bash
     npm run manifest
     ```

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

## Building for Production

```bash
npm run build
```

Build artifacts are output to `dist/reasoning-trace-vis/browser/`, ready for static hosting.

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
