# Trace converters

Scripts that turn an agent's own logs into [OpenTraces](https://www.opentraces.ai) JSON that `agent-trace-vis` can load. Each is a single Python file with no dependencies beyond the standard library (3.8+).

| Script | Source |
|---|---|
| [`convert_copilot_chat.py`](convert_copilot_chat.py) | GitHub Copilot Chat in VS Code (agent or ask mode) |

## Convert your GitHub Copilot chats

```bash
python3 converters/convert_copilot_chat.py --list   # show your chat sessions
python3 converters/convert_copilot_chat.py          # convert the 10 most recent
python3 converters/convert_copilot_chat.py a1b2c3   # or specific ones, by id prefix
npm start                                           # they appear under "Copilot Chats"
```

The script finds VS Code's chat logs automatically (`~/Library/Application Support/Code/User` on macOS, `~/.config/Code/User` on Linux, `%APPDATA%\Code\User` on Windows; use `-i` for another location) and writes to `../reasoning_vis_data/traces/copilot_chats/`, creating it if needed. Your home directory is replaced with `~` in all paths so the output is safe to share; pass `--no-scrub-home` to keep it.

What Copilot does and doesn't record (timing, tool results, reasoning) is described at the top of the script.

## Write a converter for another agent

Copy `convert_copilot_chat.py` and replace its first two layers, keeping the third:

1. `discover_sessions()` – find your agent's log files.
2. `build_turns()` – parse them into a list of neutral *turn* dicts (user message, then the agent's messages with their reasoning and tool calls). This dict is the only contract between the layers and is documented at the top of the script.
3. `to_opentraces()` – unchanged; turns the dicts into OpenTraces JSON.

Two conventions make traces light up the right lanes:

- **Tool names** are matched by substring (`read_file`, `edit`, `grep`, `find`, `run`/`terminal`, `fetch`, …); see [`tools.ts`](../src/app/agentic-traces/tools.ts).
- **File paths** should sit under a recognised input key such as `filePath`, `file_path`, `path` or `TargetFile`. For a result that touched several files, put one `File Path: /abs/path` line per file in the observation.

Write only schema fields into steps and tool calls ([`trace.ts`](../src/app/agentic-traces/trace.ts) mirrors the schema exactly). Anything beyond the schema — per-call timing, reasoning token counts, per-turn token totals, subagent links — goes into the record's free-form `metadata` under the keys documented in [`trace-extensions.ts`](../src/app/agentic-traces/trace-extensions.ts). The minimal JSON structure is shown under *Getting Started* in the [main README](../README.md).
