# Trace converters

Scripts that turn an agent's own logs into the trace format defined by [our library](../src/app/agentic-traces/trace.ts), based on OpenTraces. They use Python 3.8+ and the standard library, with shared helpers from this directory; no pip dependencies are required.

| Script | Source |
|---|---|
| [`convert_copilot_chat.py`](convert_copilot_chat.py) | VS Code Copilot Chat logs and Copilot SDK event logs |

## Convert your GitHub Copilot sessions

```bash
python3 converters/convert_copilot_chat.py --list
python3 converters/convert_copilot_chat.py
python3 converters/convert_copilot_chat.py a1b2c3
npm start
```

The command discovers both VS Code's chat logs (`~/Library/Application Support/Code/User` on macOS, `~/.config/Code/User` on Linux, `%APPDATA%\Code\User` on Windows) and SDK logs under `~/.copilot/session-state`. It converts every available session except the two previously removed traces; use `-n` to limit the newest sessions, `-i` to override VS Code's User directory, or `--sdk-input-dir` to override the SDK directory. Output goes to `../reasoning_vis_data/traces/copilot_chats/`. Your home directory is replaced with `~` in paths unless `--no-scrub-home` is given.

The converter handles both underlying formats directly and uses the same trace emitter for each.
SDK trace titles use a title from session metadata when available, or the first user query otherwise.

## Write a converter for another agent

Copy `convert_copilot_chat.py` and replace its first two layers, keeping the third:

1. `discover_sessions()` – find your agent's log files.
2. `build_turns()` – parse them into a list of neutral *turn* dicts (user message, then the agent's messages with their reasoning and tool calls). This dict is the only contract between the layers and is documented at the top of the script.
3. `to_opentraces()` – turns the dicts into the trace format based on OpenTraces. Add source tool-name mappings in `tool_kind_for_name()` so new traces include `metadata.tool_kinds`.

- **Tool kinds** go in `metadata.tool_kinds`, keyed by the original tool name. Use the `ToolKind` values defined in [`trace-extensions.ts`](../src/app/agentic-traces/trace-extensions.ts); keep source tool names and inputs intact. Missing kinds fall back to best-effort name inference.
- **File paths** should sit under a recognised input key such as `filePath`, `file_path`, `path` or `TargetFile`. For a result that touched several files, put one `File Path: /abs/path` line per file in the observation.

Write schema fields into steps and tool calls ([`trace.ts`](../src/app/agentic-traces/trace.ts) mirrors the schema). Additional data such as kinds, timing, and token counts goes in `metadata`. See *Getting Started* in the [main README](../README.md) for the minimal trace structure.
