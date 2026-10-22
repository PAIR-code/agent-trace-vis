#!/usr/bin/env python3
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     https://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.

"""
Convert GitHub Copilot Chat (VS Code agent mode) sessions to OpenTraces JSON
for the agent-trace-vis visualizer.

Quick start
-----------
    python3 converters/convert_copilot_chat.py --list     # what sessions do I have?
    python3 converters/convert_copilot_chat.py            # convert the 10 most recent
    python3 converters/convert_copilot_chat.py <session>  # convert one (id prefix is fine)
    npm start                                             # view them

No dependencies beyond the Python 3.8+ standard library. Output goes to the
app's data folder (``../reasoning_vis_data/traces/copilot_chats/`` next to this
repo, created if missing), which ``npm start`` picks up automatically.

Where Copilot keeps its chats
-----------------------------
VS Code stores one folder per workspace under ``User/workspaceStorage/<hash>/``
in its user-data dir (macOS: ``~/Library/Application Support/Code``, Linux:
``~/.config/Code``, Windows: ``%APPDATA%\\Code``). For each chat session
``<sid>`` there are two complementary logs, and this script merges both:

* ``chatSessions/<sid>.jsonl`` -- written by VS Code core for every chat
  provider. An event-sourced patch log (see ``replay_chat_session``). After
  replay it holds every request: user text, timestamps, model, token counts,
  title, and per-tool-call *result summaries*.
* ``GitHub.copilot-chat/transcripts/<sid>.jsonl`` -- written by the Copilot
  extension in agent mode. A flat event list with the assistant's messages,
  reasoning text (when the model exposes it), and tool calls with *parsed
  arguments*. It omits the first user message (it precedes ``session.start``)
  and has no tool outputs, which is why both files are needed.

What the logs do and don't contain
----------------------------------
* Timing is real and per call: the transcript stamps when each model
  generation finished and when each tool started and returned, so the
  timeline separates thinking time from tool time (a 3-minute web fetch is a
  3-minute tool bar, not thinking).
* Tool results are summaries ("Read file.ts, lines 1 to 260", "exit code 2"),
  not raw outputs; Copilot doesn't log those.
* Token usage (input/output) is reported per turn, not per LLM call. It is
  written to ``metadata.turn_token_usage``; steps carry no ``token_usage``.
* For models whose reasoning Copilot doesn't expose (e.g. OpenAI models) the
  thinking *text* is unavailable, but the per-call reasoning *token count* is
  recorded (``metadata.reasoning_tokens``), so the thinking lane still shows
  how much the model thought before each action.
* Sessions without an agent-mode transcript (ask mode, older versions) still
  convert from the chat log alone, with less tool detail.

Forking this for another agent's logs
-------------------------------------
The script is three layers; to support a new source you replace the first
two and keep the third:

1. **Discover** -- ``discover_sessions()`` finds log files and returns
   ``Session`` records. Point it at your agent's directory.
2. **Parse** -- ``build_turns()`` reads the raw logs and produces a list of
   neutral ``Turn`` dicts. This dict is the only contract between the layers:

       {"user": str, "timestamp": iso8601, "model": str|None,
        "token_usage": {"input_tokens": int, "output_tokens": int}|None,
        "messages": [{"content": str, "reasoning": str,
                      "started_at": iso8601,      # model began generating
                      "timestamp": iso8601,       # model finished generating
                      "reasoning_tokens": int|None,
                      "tool_calls": [{"id": str, "name": str, "input": dict,
                                      "result": str, "error": str|None,
                                      "started_at": iso8601|None,
                                      "duration_ms": int|None}]}]}

   Timing matters for the timeline: ``started_at``→``timestamp`` is the time
   the model spent thinking and writing; each tool's ``started_at`` +
   ``duration_ms`` is the time spent waiting on it. Without these the
   visualizer can only guess from step order.

   ``reasoning_tokens`` is per LLM call. Copilot encrypts the reasoning text
   of OpenAI models but still records how many tokens it used
   (``result.metadata.toolCallRounds[].thinking.tokens`` in the chat log), so
   the thinking lane can show the *amount* of thinking even when the words
   are unavailable.

3. **Emit** -- ``to_opentraces()`` turns ``Turn`` dicts into an OpenTraces
   v0.7.0 record. You should not need to touch it.

What the visualizer reads, so your ``Turn`` dicts light up the right lanes:

* ``tool_calls[].name`` decides the lane/icon by substring match (see
  ``src/app/agentic-traces/tools.ts``): ``read_file``/``view`` -> file view,
  ``edit``/``patch``/``write`` -> file edit, ``grep`` -> grep, ``find``/
  ``file_search`` -> find, ``run``/``terminal``/``bash`` -> command, ``fetch``/
  ``read_url`` -> URL, ``search_web`` -> web search.
* ``tool_calls[].input`` should name files under a recognised key
  (``filePath``, ``file_path``, ``path``, ``TargetFile``, ...) and commands
  under ``command``/``CommandLine``. For multi-file results, put one
  ``File Path: /abs/path`` line per file in ``result``.
* ``reasoning`` fills the thinking lane, ``content`` the response lane,
  ``model`` colours the step, ``token_usage`` feeds the token summary.
"""

import argparse
import datetime as dt
import json
import os
import re
import sys
from dataclasses import dataclass, field
from typing import Dict, List, Optional

SCHEMA_VERSION = "0.9.0"
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
REPO_DIR = os.path.dirname(SCRIPT_DIR)
DEFAULT_OUTPUT = os.path.normpath(os.path.join(REPO_DIR, "..", "reasoning_vis_data", "traces", "copilot_chats"))


# ===========================================================================
# 1. Discover
# ===========================================================================

@dataclass
class Session:
    session_id: str
    chat_path: str                      # chatSessions/<sid>.jsonl (always present)
    transcript_path: Optional[str]      # GitHub.copilot-chat/transcripts/<sid>.jsonl (agent mode only)
    workspace_folder: Optional[str]
    mtime: float
    title: str = ""


def vscode_user_dirs() -> List[str]:
    """Candidate VS Code ``User`` directories on this machine (stable + Insiders)."""
    home = os.path.expanduser("~")
    if sys.platform == "darwin":
        roots = [os.path.join(home, "Library", "Application Support")]
    elif sys.platform.startswith("win"):
        roots = [os.environ.get("APPDATA", os.path.join(home, "AppData", "Roaming"))]
    else:
        roots = [os.environ.get("XDG_CONFIG_HOME", os.path.join(home, ".config"))]
    dirs = []
    for root in roots:
        for app in ("Code", "Code - Insiders", "VSCodium"):
            d = os.path.join(root, app, "User")
            if os.path.isdir(d):
                dirs.append(d)
    return dirs


def discover_sessions(user_dirs: List[str]) -> List[Session]:
    """Every chat session in every workspace (plus window-less chats), newest first."""
    sessions = []
    for user_dir in user_dirs:
        chat_dirs = [(os.path.join(user_dir, "globalStorage", "emptyWindowChatSessions"), None)]
        ws_root = os.path.join(user_dir, "workspaceStorage")
        if os.path.isdir(ws_root):
            chat_dirs += [(os.path.join(ws_root, ws, "chatSessions"), os.path.join(ws_root, ws)) for ws in os.listdir(ws_root)]
        for chat_dir, ws_dir in chat_dirs:
            if not os.path.isdir(chat_dir):
                continue
            folder = None
            if ws_dir:
                try:
                    with open(os.path.join(ws_dir, "workspace.json"), encoding="utf-8") as f:
                        folder = json.load(f).get("folder")
                except (OSError, ValueError):
                    pass
            for name in os.listdir(chat_dir):
                sid, ext = os.path.splitext(name)
                if ext not in (".jsonl", ".json"):  # .json = older single-snapshot format
                    continue
                chat_path = os.path.join(chat_dir, name)
                transcript = os.path.join(ws_dir, "GitHub.copilot-chat", "transcripts", sid + ".jsonl") if ws_dir else ""
                sessions.append(Session(
                    session_id=sid,
                    chat_path=chat_path,
                    transcript_path=transcript if transcript and os.path.exists(transcript) else None,
                    workspace_folder=folder,
                    mtime=os.path.getmtime(chat_path),
                ))
    sessions.sort(key=lambda s: s.mtime, reverse=True)
    return sessions


# ===========================================================================
# 2. Parse
# ===========================================================================

def replay_chat_session(path: str) -> dict:
    """Load a VS Code chat session: either a plain ``.json`` snapshot (older
    builds) or the ``.jsonl`` patch log, which is replayed into the final
    session object.

    In the patch log each line is one operation: ``kind 0`` = full snapshot,
    ``kind 1`` = set the value at key path ``k``, ``kind 2`` = append ``v`` to
    the array at ``k`` (or, when ``i`` is present, replace the array's tail
    from index ``i``).
    """
    if path.endswith(".json"):
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f) or {}
        except (OSError, ValueError):
            return {}
    state = None
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            try:
                op = json.loads(line)
            except json.JSONDecodeError:
                continue
            kind = op.get("kind")
            if kind == 0:
                state = op["v"]
                continue
            if state is None:
                continue
            target = state
            try:
                if kind == 1:
                    for k in op["k"][:-1]:
                        target = target[k]
                    target[op["k"][-1]] = op["v"]
                elif kind == 2:
                    for k in op["k"]:
                        target = target[k]
                    if "i" in op:
                        target[op["i"]:] = op.get("v", [])
                    else:
                        target.extend(op.get("v", []))
            except (KeyError, IndexError, TypeError):
                continue  # tolerate patches against paths we don't have
    return state or {}


def read_transcript(path: Optional[str]) -> List[dict]:
    """Copilot's flat agent transcript, in file order."""
    if not path:
        return []
    events = []
    with open(path, encoding="utf-8") as f:
        for line in f:
            line = line.strip()
            if line:
                try:
                    events.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return events


# ---- small helpers ----------------------------------------------------------

def iso(ms: Optional[float]) -> Optional[str]:
    if ms is None:
        return None
    return dt.datetime.fromtimestamp(ms / 1000, tz=dt.timezone.utc).isoformat().replace("+00:00", "Z")


def md_text(v) -> str:
    """VS Code markdown strings are either plain strings or ``{"value": ...}``."""
    if isinstance(v, dict):
        return str(v.get("value") or "")
    return str(v or "")


def uri_path(u) -> Optional[str]:
    """Local path from a serialized VS Code URI (or a ``file://`` string)."""
    if isinstance(u, dict):
        if u.get("scheme") not in (None, "file"):
            return u.get("external") or None
        return u.get("fsPath") or u.get("path")
    if isinstance(u, str):
        return u[len("file://"):] if u.startswith("file://") else u
    return None


def snake(name: str) -> str:
    """``copilot_readFile`` -> ``read_file``; used only when no transcript exists."""
    name = re.sub(r"^(copilot_|vscode_)", "", name)
    name = re.sub(r"_internal$", "", name)
    return re.sub(r"(?<!^)(?=[A-Z])", "_", name).lower()


PATCH_FILE_RE = re.compile(r"^\*\*\* (?:Update|Add|Delete) File: (.+)$", re.MULTILINE)


def normalize_input(name: str, inp: dict) -> dict:
    """Light touch so the visualizer can find files / commands in the input."""
    inp = dict(inp)
    if name == "apply_patch" and isinstance(inp.get("input"), str):
        files = [p.strip() for p in PATCH_FILE_RE.findall(inp["input"])]
        if files:
            inp.setdefault("file_path", files[0])
            inp["files"] = files
    if name == "fetch_webpage" and isinstance(inp.get("urls"), list) and inp["urls"]:
        inp.setdefault("url", inp["urls"][0])
    return inp


def result_from_part(part: dict) -> (str, Optional[str], List[str]):
    """(summary text, error, files touched) from a ``toolInvocationSerialized`` part."""
    lines = []
    error = None
    files = []
    tsd = part.get("toolSpecificData") or {}
    if tsd.get("kind") == "terminal":
        st = tsd.get("terminalCommandState") or {}
        if "exitCode" in st:
            lines.append(f"exit code: {st['exitCode']}")
            if st["exitCode"] not in (0, None):
                error = f"exit code {st['exitCode']}"
    if tsd.get("kind") == "subagent" and tsd.get("result"):
        lines.append(str(tsd["result"]))
    summary = md_text(part.get("pastTenseMessage")) or md_text(part.get("invocationMessage"))
    if summary:
        lines.insert(0, summary)
    rd = part.get("resultDetails")
    if isinstance(rd, list):
        for item in rd:
            p = uri_path(item.get("uri", item) if isinstance(item, dict) else item)
            if p:
                files.append(p)
    elif isinstance(rd, dict) and isinstance(rd.get("output"), list):
        for o in rd["output"]:
            if isinstance(o, dict) and o.get("type") == "text":
                lines.append(str(o.get("value", "")))
    inv = part.get("invocationMessage")
    for u in (inv.get("uris") or {}).values() if isinstance(inv, dict) else []:
        p = uri_path(u)
        if p:
            files.append(p)
    confirmed = part.get("isConfirmed")
    if isinstance(confirmed, dict) and confirmed.get("type") == 3:
        error = error or "cancelled by user"
    return "\n".join(lines), error, list(dict.fromkeys(files))


def with_file_lines(result: str, files: List[str]) -> str:
    """Append ``File Path:`` lines so the files lane sees every file touched."""
    if not files:
        return result
    return (result + "\n" if result else "") + "\n".join(f"File Path: {p}" for p in files)


def apply_part_results(call: dict, part: Optional[dict]):
    """Attach the chat log's result summary for one tool call."""
    if not part:
        return
    result, error, files = result_from_part(part)
    call["result"] = with_file_lines(result, files)
    if error:
        call["error"] = error
    if part.get("isComplete") is False:
        call["error"] = call.get("error") or "did not complete"


# ---- the merge ----------------------------------------------------------------

def build_turns(state: dict, events: List[dict]) -> List[dict]:
    """Merge the chat log (requests, results, tokens) with the Copilot transcript
    (messages, reasoning, tool args) into neutral ``Turn`` dicts."""
    requests = state.get("requests") or []
    turns = []
    for r in requests:
        parts = r.get("response") or []
        model = None
        for p in parts:
            if p.get("kind") == "autoModeResolution":
                model = (p.get("resolved") or {}).get("id")
        if not model and r.get("modelId") and not str(r["modelId"]).endswith("/auto"):
            model = str(r["modelId"]).split("/")[-1]
        token_usage = None
        if r.get("promptTokens") is not None or r.get("completionTokens") is not None:
            token_usage = {"input_tokens": r.get("promptTokens") or 0,
                           "output_tokens": r.get("completionTokens") or 0}
        meta = (r.get("result") or {}).get("metadata") or {}
        if not model and meta.get("resolvedModel"):
            model = meta["resolvedModel"]
        turns.append({
            "user": (r.get("message") or {}).get("text", ""),
            "timestamp": iso(r.get("timestamp")),
            "model": model,
            "token_usage": token_usage,
            "messages": [],
            "_parts": parts,
            "_parts_by_call": {p.get("toolCallId"): p for p in parts if p.get("kind") == "toolInvocationSerialized"},
            "_rounds": meta.get("toolCallRounds") or [],
        })

    if events:
        _fill_from_transcript(turns, events)
    for t in turns:
        if not t["messages"]:
            _fill_from_parts(t)
        _attach_rounds(t)
        for k in ("_parts", "_parts_by_call", "_rounds"):
            t.pop(k, None)
    return turns


def _attach_rounds(turn: dict):
    """One ``toolCallRound`` = one LLM call. Attach its reasoning token count
    (and model) to the message it produced: matched by tool-call id, or, for
    text-only rounds, to the next text-only message in order."""
    def bare(call_id):  # 'call_abc__vscode-123' -> 'call_abc'
        return str(call_id or "").split("__vscode-")[0]

    by_call = {bare(c["id"]): m for m in turn["messages"] for c in m["tool_calls"]}
    textual = [m for m in turn["messages"] if not m["tool_calls"]]
    for rnd in turn["_rounds"]:
        msg = next((by_call[bare(c.get("id"))] for c in rnd.get("toolCalls") or [] if bare(c.get("id")) in by_call), None)
        if msg is None and not rnd.get("toolCalls") and textual:
            msg = textual.pop(0)
        if msg is None:
            continue
        thinking = rnd.get("thinking") or {}
        if isinstance(thinking.get("tokens"), (int, float)):
            msg["reasoning_tokens"] = msg.get("reasoning_tokens", 0) + int(thinking["tokens"])
        if rnd.get("modelId"):
            msg["model"] = rnd["modelId"]
        if isinstance(thinking.get("text"), str) and thinking["text"] and not msg["reasoning"]:
            msg["reasoning"] = thinking["text"]


def _fill_from_transcript(turns: List[dict], events: List[dict]):
    """Partition transcript events by ``user.message`` and attach each slice to
    the matching request. The slice before the first ``user.message`` belongs
    to the first request (whose user text the transcript never records)."""
    if not turns:
        return
    # Boundaries: index of each user.message event, matched to a request.
    bounds = [(0, 0)]  # (event index, turn index)
    unmatched = set(range(1, len(turns)))
    for i, ev in enumerate(events):
        if ev.get("type") != "user.message":
            continue
        text = (ev.get("data") or {}).get("content", "")
        ts = _parse_iso(ev.get("timestamp"))
        best = None
        for ti in sorted(unmatched):
            if turns[ti]["user"].strip() == text.strip():
                best = ti
                break
        if best is None and ts is not None:
            cands = [(abs((_parse_iso(turns[ti]["timestamp"]) or ts) - ts), ti) for ti in unmatched]
            if cands:
                d, ti = min(cands)
                if d <= 10:
                    best = ti
        if best is None:
            continue
        unmatched.discard(best)
        bounds.append((i + 1, best))

    bounds.sort()
    for n, (start, ti) in enumerate(bounds):
        end = bounds[n + 1][0] - 1 if n + 1 < len(bounds) else len(events)
        turn = turns[ti]
        calls_by_id: Dict[str, dict] = {}
        # When the model started its current generation: the user message,
        # or the moment the previous tool finished / previous message ended.
        gen_start = events[start - 1].get("timestamp") if start > 0 else turn["timestamp"]
        for ev in events[start:end]:
            etype = ev.get("type")
            data = ev.get("data") or {}
            if etype == "assistant.message":
                msg = {"content": data.get("content") or "",
                       "reasoning": data.get("reasoningText") or "",
                       "started_at": gen_start,
                       "timestamp": ev.get("timestamp"),
                       "tool_calls": []}
                gen_start = ev.get("timestamp")
                for tr in data.get("toolRequests") or []:
                    name = tr.get("name") or "tool"
                    try:
                        args = json.loads(tr.get("arguments") or "{}")
                    except json.JSONDecodeError:
                        args = {"arguments": tr.get("arguments")}
                    call = {"id": tr.get("toolCallId"), "name": name,
                            "input": normalize_input(name, args if isinstance(args, dict) else {"value": args}),
                            "result": "", "error": None, "started_at": None, "duration_ms": None}
                    apply_part_results(call, turn["_parts_by_call"].get(call["id"]))
                    msg["tool_calls"].append(call)
                    calls_by_id[call["id"]] = call
                turn["messages"].append(msg)
            elif etype == "tool.execution_start":
                call = calls_by_id.get(data.get("toolCallId"))
                if call:
                    call["started_at"] = ev.get("timestamp")
                    if isinstance(data.get("arguments"), dict) and not call["input"]:
                        call["input"] = normalize_input(call["name"], data["arguments"])
            elif etype == "tool.execution_complete":
                call = calls_by_id.get(data.get("toolCallId"))
                if call:
                    t0, t1 = _parse_iso(call.get("started_at")), _parse_iso(ev.get("timestamp"))
                    if t0 is not None and t1 is not None:
                        call["duration_ms"] = max(0, int(round((t1 - t0) * 1000)))
                    if data.get("success") is False:
                        call["error"] = call["error"] or (data.get("error") or "tool failed")
                gen_start = ev.get("timestamp")  # the model resumes after the tool returns


def _fill_from_parts(turn: dict):
    """Fallback when there is no Copilot transcript (ask mode, other providers):
    reconstruct messages from the chat log's response parts alone."""
    msg = None
    for p in turn["_parts"]:
        kind = p.get("kind")
        if kind is None and "value" in p:            # markdown text part
            if msg is None or msg["tool_calls"]:
                msg = {"content": "", "reasoning": "", "timestamp": turn["timestamp"], "tool_calls": []}
                turn["messages"].append(msg)
            msg["content"] += md_text(p)
        elif kind == "toolInvocationSerialized":
            if msg is None:
                msg = {"content": "", "reasoning": "", "timestamp": turn["timestamp"], "tool_calls": []}
                turn["messages"].append(msg)
            name = snake(p.get("toolId") or "tool")
            inp = {}
            rd = p.get("resultDetails")
            if isinstance(rd, dict) and isinstance(rd.get("input"), str):
                try:
                    inp = json.loads(rd["input"])
                except json.JSONDecodeError:
                    inp = {"input": rd["input"]}
            tsd = p.get("toolSpecificData") or {}
            started_at, duration_ms = None, None
            if tsd.get("kind") == "terminal":
                inp.setdefault("command", (tsd.get("commandLine") or {}).get("original"))
                st = tsd.get("terminalCommandState") or {}
                if st.get("timestamp") and st.get("duration") is not None:
                    # VS Code stamps the command's end; back out the start.
                    started_at = iso(st["timestamp"] - st["duration"])
                    duration_ms = int(st["duration"])
            if tsd.get("kind") == "subagent":
                inp.setdefault("query", tsd.get("prompt"))
            _, _, files = result_from_part(p)
            if files and "filePath" not in inp and "file_path" not in inp:
                inp["file_path"] = files[0]
            call = {"id": p.get("toolCallId"), "name": name, "input": normalize_input(name, inp),
                    "result": "", "error": None, "started_at": started_at, "duration_ms": duration_ms}
            apply_part_results(call, p)
            msg["tool_calls"].append(call)
    # Ask-mode answers have no parts list of tool calls but do have text.
    if not turn["messages"] and turn["_parts"]:
        text = "".join(md_text(p) for p in turn["_parts"] if p.get("kind") is None and "value" in p)
        if text:
            turn["messages"].append({"content": text, "reasoning": "", "timestamp": turn["timestamp"], "tool_calls": []})


def _parse_iso(s: Optional[str]) -> Optional[float]:
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ===========================================================================
# 3. Emit
# ===========================================================================

def to_opentraces(turns: List[dict], *, trace_id: str, title: str, agent: dict, metadata: dict) -> dict:
    """Neutral ``Turn`` dicts -> OpenTraces record.

    Steps and tool calls contain only schema fields. Everything the schema has
    no field for (per-call timing, reasoning token counts) goes into the
    record's free-form ``metadata`` under the keys the visualizer documents in
    ``src/app/agentic-traces/trace-extensions.ts``.
    """
    steps = []
    last_model = agent.get("model")
    step_timing: Dict[str, dict] = {}
    tool_timing: Dict[str, dict] = {}
    reasoning_tokens: Dict[str, int] = {}
    turn_token_usage: Dict[str, dict] = {}
    for turn in turns:
        user_key = str(len(steps))
        steps.append({"step_index": len(steps), "role": "user",
                      "content": turn["user"], "timestamp": turn["timestamp"]})
        model = turn.get("model") or last_model
        last_model = model
        agent_steps = []
        for i, msg in enumerate(turn["messages"]):
            if not (msg["content"].strip() or msg["reasoning"].strip() or msg["tool_calls"]):
                continue
            generated_at = msg.get("timestamp") or turn["timestamp"]
            step = {"step_index": len(steps), "role": "agent", "model": msg.get("model") or model,
                    "reasoning_content": msg["reasoning"], "content": msg["content"],
                    "tool_calls": [], "observations": [],
                    # The step starts when the model starts generating; when it
                    # finished and when its last tool returned go to metadata.
                    "timestamp": msg.get("started_at") or generated_at}
            key = str(step["step_index"])
            timing = {"generated_at": generated_at}
            completed = _parse_iso(generated_at)
            if msg.get("reasoning_tokens") is not None:
                reasoning_tokens[key] = msg["reasoning_tokens"]
            for k, call in enumerate(msg["tool_calls"]):
                call_id = call.get("id") or f"tc_{len(steps)}_{k}"
                tc = {"tool_call_id": call_id, "tool_name": call["name"], "input": call.get("input") or {}}
                if call.get("started_at"):
                    tool_timing[call_id] = {"started_at": call["started_at"]}
                if call.get("duration_ms") is not None:
                    tc["duration_ms"] = call["duration_ms"]
                    t_end = (_parse_iso(call["started_at"]) or 0) + call["duration_ms"] / 1000
                    completed = max(completed or 0, t_end)
                step["tool_calls"].append(tc)
                obs = {"source_call_id": call_id, "content": call.get("result") or ""}
                if call.get("error"):
                    obs["error"] = call["error"]
                step["observations"].append(obs)
            if completed and completed > (_parse_iso(step["timestamp"]) or 0):
                timing["completed_at"] = iso(completed * 1000)
            step_timing[key] = timing
            steps.append(step)
            agent_steps.append(step)
        if turn.get("token_usage"):
            # Copilot reports input/output totals per request, not per LLM call,
            # so they are recorded per turn (keyed by the user step) rather than
            # pinned to one step as if that step alone had used them.
            turn_token_usage[user_key] = dict(turn["token_usage"])

    timestamps = [s["timestamp"] for s in steps if s.get("timestamp")]
    record = {
        "schema_version": SCHEMA_VERSION,
        "trace_id": trace_id,
        "session_id": trace_id,
        "timestamp_start": min(timestamps) if timestamps else None,
        "timestamp_end": max(timestamps) if timestamps else None,
        "task": {"description": title},
        "agent": agent,
        "steps": steps,
        "metrics": {
            "total_steps": len(steps),
            "total_input_tokens": sum((t.get("token_usage") or {}).get("input_tokens", 0) for t in turns),
            "total_output_tokens": sum((t.get("token_usage") or {}).get("output_tokens", 0) for t in turns),
        },
        "metadata": {
            **metadata,
            "step_timing": step_timing,
            "tool_timing": tool_timing,
            "reasoning_tokens": reasoning_tokens,
            "turn_token_usage": turn_token_usage,
            "total_reasoning_tokens": sum(reasoning_tokens.values()),
        },
    }
    if last_model and not agent.get("model"):
        agent["model"] = last_model
    return record


# ===========================================================================
# CLI
# ===========================================================================

def display_path(p: str) -> str:
    rel = os.path.relpath(p)
    return rel if not rel.startswith("..") else p.replace(os.path.expanduser("~"), "~")


def sanitize_filename(name: str) -> str:
    safe = re.sub(r'[\\/:*?"<>|#%&+]', " ", name)
    return re.sub(r"\s+", " ", safe).strip()[:120]


def session_title(state: dict, turns: List[dict]) -> str:
    title = (state.get("customTitle") or "").strip()
    if not title and turns:
        title = turns[0]["user"].strip().split("\n")[0]
    if len(title) > 80:
        title = title[:77] + "..."
    return title


def convert_session(s: Session, output_dir: str, scrub_home: bool) -> Optional[str]:
    state = replay_chat_session(s.chat_path)
    events = read_transcript(s.transcript_path)
    turns = build_turns(state, events)
    if not turns:
        return None

    start = next((e for e in events if e.get("type") == "session.start"), {}).get("data", {})
    req0 = (state.get("requests") or [{}])[0]
    agent = {"name": "github-copilot",
             "version": start.get("copilotVersion") or (req0.get("agent") or {}).get("extensionVersion") or "unknown"}
    model = next((t["model"] for t in turns if t.get("model")), None)
    if model:
        agent["model"] = model
    metadata = {
        "source": "vscode-copilot-chat",
        "workspace_folder": s.workspace_folder,
        "vscode_version": start.get("vscodeVersion"),
        "source_files": [p for p in (s.chat_path, s.transcript_path) if p],
    }
    title = session_title(state, turns) or s.session_id
    record = to_opentraces(turns, trace_id=s.session_id, title=title, agent=agent, metadata=metadata)

    text = json.dumps(record, indent=2, ensure_ascii=False)
    if scrub_home:
        home = os.path.expanduser("~")
        text = text.replace(home, "~").replace(json.dumps(home)[1:-1], "~")

    os.makedirs(output_dir, exist_ok=True)
    out = os.path.join(output_dir, f"{sanitize_filename(title) or s.session_id}.json")
    with open(out, "w", encoding="utf-8") as f:
        f.write(text)
    n_tools = sum(len(st.get("tool_calls") or []) for st in record["steps"])
    print(f"  ✓ {s.session_id[:8]}  {len(turns)} turns, {len(record['steps'])} steps, {n_tools} tool calls"
          f"{'' if s.transcript_path else '  (no agent transcript; results only)'} -> {display_path(out)}")
    return out


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0],
                                 formatter_class=argparse.RawDescriptionHelpFormatter,
                                 epilog="Full notes, including how to adapt this script to another agent's "
                                        "logs, are in the module docstring at the top of the file.")
    ap.add_argument("session", nargs="*", help="session id(s) or id prefix(es) to convert")
    ap.add_argument("-n", "--limit", type=int, default=10, help="convert the N most recent sessions (default 10)")
    ap.add_argument("-i", "--input-dir", action="append",
                    help="VS Code 'User' directory to scan (repeatable; default: auto-detect)")
    ap.add_argument("-o", "--output-dir", default=DEFAULT_OUTPUT, help=f"output folder (default: {DEFAULT_OUTPUT})")
    ap.add_argument("--list", action="store_true", help="list sessions and exit")
    ap.add_argument("--no-scrub-home", action="store_true", help="keep your home directory in paths")
    args = ap.parse_args()

    user_dirs = args.input_dir or vscode_user_dirs()
    sessions = discover_sessions(user_dirs)
    if not sessions:
        print("No chat sessions found. Looked in:\n  " + "\n  ".join(user_dirs or ["(no VS Code user dir detected)"]))
        print("Use -i to point at your VS Code 'User' directory.")
        return 1

    # Drop sessions with no requests (VS Code creates one per window it opens).
    states = {s.session_id: replay_chat_session(s.chat_path) for s in sessions}
    sessions = [s for s in sessions if states[s.session_id].get("requests")]
    if not sessions:
        print("Found chat session files, but none contain any messages yet.")
        return 1

    if args.list:
        print(f"{'session':10} {'modified':17} {'agent':5} {'workspace':40} title")
        for s in sessions:
            st = states[s.session_id]
            title = session_title(st, build_turns(st, []))
            ws = (s.workspace_folder or "").replace("file://", "").replace(os.path.expanduser("~"), "~")
            print(f"{s.session_id[:8]:10} {dt.datetime.fromtimestamp(s.mtime):%Y-%m-%d %H:%M}  "
                  f"{'yes' if s.transcript_path else 'no ':5} {ws[-40:]:40} {title}")
        print("\n'agent' = has a Copilot agent-mode transcript (tool inputs + reasoning); "
              "'no' = results and messages only.")
        return 0

    if args.session:
        chosen = [s for s in sessions if any(s.session_id.startswith(p) for p in args.session)]
        missing = [p for p in args.session if not any(s.session_id.startswith(p) for s in sessions)]
        for p in missing:
            print(f"  ✗ no session matching {p!r}")
    else:
        chosen = sessions[:args.limit]

    print(f"Converting {len(chosen)} session(s) to {args.output_dir}")
    written = [convert_session(s, args.output_dir, scrub_home=not args.no_scrub_home) for s in chosen]
    if any(written):
        print("\nDone. Run `npm start` in agent-trace-vis and open the Agentic Traces view.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
