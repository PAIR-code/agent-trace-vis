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
Convert multi-agent team rollouts (RLTracer file-monitor traces, where a team
of peer agents message each other while proving a Lean theorem) to OpenTraces
JSON for the agent-trace-vis visualizer: one trace file per agent, linked into
a team.

Quick start
-----------
    # Straight from the release zip (streams it; nothing is extracted):
    python3 converters/convert_swarm_team.py path/to/run.zip --step 1 -n 5

    # Particular teams (1-based position in the step; titles keep that number):
    python3 converters/convert_swarm_team.py path/to/run.zip --step 5 --teams 8 9 16

    # Or from an extracted step file, or from team JSON files written by an
    # earlier sampling step ({"agents": [trace, ...]} per file):
    python3 converters/convert_swarm_team.py path/to/step_01.jsonl -n 5
    python3 converters/convert_swarm_team.py sample_teams/*.json
    npm start

No dependencies beyond the Python 3.8+ standard library. Output goes to
``data/local/traces/swarm_teams/`` (gitignored) unless ``-o`` is given.

The source format
-----------------
Each JSONL line holds ``traces``: one per agent. Agents of one team share
``info.society.botbook_session_id`` (and are consecutive lines). Per agent:

* ``nodes[].message`` -- the agent's own chat: system prompt, the theorem
  (user), then assistant turns (``reasoning_content``, ``content``,
  ``tool_calls``) each followed by the tool results. The harness also injects
  ``tool`` messages with a ``notification-...`` id when a teammate's message
  arrives mid-generation (the generation is interrupted).
* ``calls[]`` -- one per model call, keyed by the assistant node index, with
  real start / end times and token usage. Node timestamps are when the node
  was *recorded* (often batched), so all timing here comes from ``calls``.
* ``info.society.events`` -- the team's shared event log, copied into every
  member, with a large progress snapshot on every tool call. It's ~97% of the
  file size and is not needed: messages are reconstructed from the agents'
  own tool calls and results, so it is dropped.

What this writes
----------------
Schema fields only in steps and tool calls; everything else in ``metadata``
under the keys documented in ``src/app/agentic-traces/trace-extensions.ts``:

* ``team`` -- the team id, its members (leader first), the leader, this
  agent's name and the team's result. The viewer keeps a team's rows
  together on one time axis.
* ``agent_messages`` -- message ids by the tool call that sent them and the
  ``read_messages`` call that received them. The viewer draws a line from
  each send to each read. Reads are matched to sends by (sender, text,
  recipient), in order. The harness's "new message" notices stay as system
  steps but aren't linked: a read is where the text actually arrived.
* ``tool_kinds`` -- ``message`` is ``message.send``; ``read_messages``,
  ``wait`` and ``check_notifications`` are ``message.receive`` (drawn in the
  messages lane); proof / lemma checks are ``execute.command``.

A rejected proof or lemma check gets an observation ``error`` (its first
compiler error), so it's drawn as a failed tool call.
"""

import argparse
import glob
import io
import json
import os
import re
import sys
import zipfile
from collections import OrderedDict, defaultdict
from datetime import datetime, timezone
from typing import Dict, Iterable, Iterator, List, Optional, Tuple

SCHEMA_VERSION = "0.9.0"
REPO_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
DEFAULT_OUTPUT = os.path.join(REPO_DIR, "data", "local", "traces", "swarm_teams")

TOOL_KINDS = {
    "message": "message.send",
    "read_messages": "message.receive",
    "wait": "message.receive",
    "check_notifications": "message.receive",
    "check_proof": "execute.command",
    "check_lemma": "execute.command",
    "lemma_library": "search.code",
}

# Longest error text kept on a failed check (the full result stays in `content`).
MAX_ERROR_CHARS = 400


# ===========================================================================
# 1. Read teams
# ===========================================================================

def _traces_from_lines(lines: Iterable[bytes]) -> Iterator[dict]:
    for line in lines:
        line = line.strip()
        if not line:
            continue
        for trace in json.loads(line).get("traces", []):
            yield trace


def _group_teams(traces: Iterable[dict]) -> Iterator[Tuple[str, List[dict]]]:
    """Consecutive traces with the same session id form a team."""
    current: Optional[str] = None
    members: List[dict] = []
    for t in traces:
        sid = ((t.get("info") or {}).get("society") or {}).get("botbook_session_id")
        if sid != current and members:
            yield current, members
            members = []
        current = sid
        members.append(t)
    if members:
        yield current, members


def read_teams(path: str, step: Optional[int], split: str) -> Iterator[Tuple[str, List[dict], Optional[int]]]:
    """Yields (session id, agent traces, step) for every team in `path`."""
    if path.endswith(".zip"):
        if step is None:
            sys.exit("--step is required when reading a zip")
        with zipfile.ZipFile(path) as zf:
            suffix = f"{split}/monitors/file/traces/stream/step_{step:02d}.jsonl"
            names = [n for n in zf.namelist() if n.endswith(suffix)]
            if not names:
                sys.exit(f"no {suffix} in {path}")
            with zf.open(names[0]) as f:
                for sid, members in _group_teams(_traces_from_lines(io.BufferedReader(f))):
                    yield sid, members, step
    elif path.endswith(".jsonl"):
        m = re.search(r"step_(\d+)\.jsonl$", path)
        with open(path, "rb") as f:
            for sid, members in _group_teams(_traces_from_lines(f)):
                yield sid, members, step if step is not None else (int(m.group(1)) if m else None)
    else:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
        agents = data.get("agents") or data.get("traces") or []
        sid = data.get("botbook_session_id") or ((agents[0].get("info") or {}).get("society") or {}).get("botbook_session_id")
        yield sid, agents, data.get("step", step)


# ===========================================================================
# 2. Convert one team
# ===========================================================================

def iso(seconds: Optional[float]) -> Optional[str]:
    if seconds is None:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def parse_json(text) -> Optional[dict]:
    if isinstance(text, dict):
        return text
    try:
        v = json.loads(text)
        return v if isinstance(v, dict) else None
    except (TypeError, ValueError):
        return None


def society(trace: dict) -> dict:
    return (trace.get("info") or {}).get("society") or {}


def check_error(name: str, content: str) -> Optional[str]:
    """The error for a failed tool result, or None."""
    result = parse_json(content)
    if result is None:
        return None
    if result.get("error"):
        return str(result["error"])[:MAX_ERROR_CHARS]
    if name in ("check_proof", "check_lemma") and result.get("valid") is False:
        errors = result.get("errors") or []
        first = str(errors[0]) if errors else result.get("status") or "rejected"
        return f"{result.get('status') or 'rejected'}: {first}"[:MAX_ERROR_CHARS]
    return None


def recipients(to, sender: str, members: List[str]) -> List[str]:
    if to in (None, "", "all", "*"):
        return [m for m in members if m != sender]
    if isinstance(to, list):
        return [str(x) for x in to if str(x) != sender]
    return [str(to)]


def build_agent_steps(trace: dict, name: str) -> dict:
    """One agent's nodes -> OpenTraces steps, plus what message matching needs."""
    nodes = trace.get("nodes") or []
    calls = {c.get("node"): c for c in trace.get("calls") or []}
    timing = trace.get("timing") or {}
    t_start = timing.get("start")
    t_end = (timing.get("generation") or {}).get("end")

    def call_time(i: int, key: str) -> Optional[float]:
        return ((calls.get(i) or {}).get("time") or {}).get(key)

    assistant_idx = [i for i, n in enumerate(nodes) if (n.get("message") or {}).get("role") == "assistant"]
    # A step's tools run from when its generation ends until the next generation starts.
    next_start = {i: call_time(j, "start") for i, j in zip(assistant_idx, assistant_idx[1:])}

    steps: List[dict] = []
    step_timing: Dict[str, dict] = {}
    tool_timing: Dict[str, dict] = {}
    sends: List[dict] = []         # {tool_call_id, to, text, time}
    reads: List[dict] = []         # {tool_call_id, messages, time}
    last_generated: Optional[float] = t_start

    def add(step: dict) -> dict:
        step["step_index"] = len(steps)
        steps.append(step)
        return step

    i = 0
    while i < len(nodes):
        msg = nodes[i].get("message") or {}
        role = msg.get("role")
        if role == "system":
            add({"role": "system", "content": msg.get("content") or "", "timestamp": iso(t_start)})
        elif role == "user":
            add({"role": "user", "content": msg.get("content") or "", "timestamp": iso(t_start)})
        elif role == "assistant":
            start = call_time(i, "start") or nodes[i].get("timestamp")
            generated = call_time(i, "end") or start
            last_generated = generated
            usage = (calls.get(i) or {}).get("usage") or {}
            step = {"role": "agent", "model": short_model((calls.get(i) or {}).get("model")),
                    "reasoning_content": msg.get("reasoning_content") or "",
                    "content": msg.get("content") or "",
                    "tool_calls": [], "observations": [], "timestamp": iso(start)}
            if usage.get("prompt_tokens") is not None or usage.get("completion_tokens") is not None:
                step["token_usage"] = {"input_tokens": usage.get("prompt_tokens") or 0,
                                       "output_tokens": usage.get("completion_tokens") or 0}
            ended = next_start.get(i) or t_end or generated
            by_raw_id: Dict[str, dict] = {}
            for k, tc in enumerate(msg.get("tool_calls") or []):
                raw_id = tc.get("id") or f"call_{k}"
                # Harness ids repeat ("call_0" every turn): make them unique per trace.
                call_id = f"{raw_id}@{i}"
                args = parse_json(tc.get("arguments"))
                inp = args if args is not None else {"raw": tc.get("arguments")}
                call = {"tool_call_id": call_id, "tool_name": tc.get("name") or "unknown", "input": inp}
                if ended and generated and ended >= generated:
                    call["duration_ms"] = round((ended - generated) * 1000, 1)
                tool_timing[call_id] = {"started_at": iso(generated)}
                step["tool_calls"].append(call)
                by_raw_id.setdefault(raw_id, call)
                if call["tool_name"] == "message":
                    sends.append({"tool_call_id": call_id, "to": inp.get("to"), "text": inp.get("text"), "time": generated})
            add(step)
            timing_entry = {"generated_at": iso(generated)}
            if step["tool_calls"] and ended and ended > generated:
                timing_entry["completed_at"] = iso(ended)
            step_timing[str(step["step_index"])] = timing_entry

            # The tool results that follow, until the next assistant turn.
            j = i + 1
            while j < len(nodes) and (nodes[j].get("message") or {}).get("role") == "tool":
                res = nodes[j]["message"]
                raw_id = res.get("tool_call_id") or ""
                call = by_raw_id.pop(raw_id, None)
                content = res.get("content") if isinstance(res.get("content"), str) else json.dumps(res.get("content"))
                if call is not None:
                    obs = {"source_call_id": call["tool_call_id"], "content": content or ""}
                    err = check_error(call["tool_name"], content)
                    if err:
                        obs["error"] = err
                    step["observations"].append(obs)
                    if call["tool_name"] == "read_messages":
                        reads.append({"tool_call_id": call["tool_call_id"],
                                      "messages": (parse_json(content) or {}).get("messages") or [],
                                      "time": ended})
                else:
                    # Injected by the harness: a teammate's message arrived.
                    note = parse_json(content) or {}
                    add({"role": "system", "content": note.get("notice") or content or "",
                         "timestamp": iso(last_generated)})
                j += 1
            i = j
            continue
        i += 1

    return {"name": name, "steps": steps, "step_timing": step_timing, "tool_timing": tool_timing,
            "sends": sends, "reads": reads}


def match_messages(agents: List[dict], members: List[str], sid: str) -> Tuple[Dict[str, dict], dict]:
    """Assigns message ids and links each send to the reads of it.

    Returns per-agent ``agent_messages`` metadata and match statistics.
    """
    links = {a["name"]: {"sent": {}, "received": {}} for a in agents}
    messages: List[dict] = []
    for a in agents:
        for s in a["sends"]:
            # Unique within the dataset, not just the team.
            mid = f"{sid[:12]}/m{len(messages) + 1}"
            to = recipients(s["to"], a["name"], members)
            messages.append({"id": mid, "sender": a["name"], "to": to, "text": s["text"], "time": s["time"],
                             "read_by": set()})
            links[a["name"]]["sent"][s["tool_call_id"]] = [mid]
    messages.sort(key=lambda m: (m["time"] or 0))

    stats = {"messages": len(messages), "reads": 0, "matched": 0, "out_of_order": 0}
    for a in agents:
        me = a["name"]
        for r in a["reads"]:
            ids = []
            for rm in r["messages"]:
                stats["reads"] += 1
                sender, text = rm.get("user_id"), rm.get("text")
                m = next((m for m in messages if m["sender"] == sender and m["text"] == text
                          and me in m["to"] and me not in m["read_by"]), None)
                if m is None:
                    continue
                m["read_by"].add(me)
                ids.append(m["id"])
                stats["matched"] += 1
                if m["time"] and r["time"] and m["time"] > r["time"]:
                    stats["out_of_order"] += 1
            if ids:
                links[me]["received"][r["tool_call_id"]] = ids
    return links, stats


def theorem_name(steps: List[dict]) -> str:
    for s in steps:
        if s["role"] == "user":
            m = re.search(r"theorem\s+(\S+)", s.get("content") or "")
            if m:
                return m.group(1)
    return "task"


def convert_team(sid: str, traces: List[dict], step: Optional[int], team_no: int) -> Tuple[List[Tuple[str, dict]], dict]:
    soc0 = society(traces[0])
    leader = soc0.get("fixed_leader")
    names = [society(t).get("public_name") or (t.get("agent") or {}).get("name") or f"agent{k}" for k, t in enumerate(traces)]
    # Leader first, then the harness's slot order.
    order = sorted(range(len(traces)), key=lambda k: (names[k] != leader, (traces[k].get("agent") or {}).get("name") or ""))
    members = [names[k] for k in order]
    metrics0 = traces[0].get("metrics") or {}
    success = bool(metrics0.get("team_success"))

    agents = [build_agent_steps(traces[k], names[k]) for k in order]
    links, stats = match_messages(agents, members, sid)
    theorem = theorem_name(agents[0]["steps"])

    out = []
    for rank, (k, a) in enumerate(zip(order, agents)):
        t = traces[k]
        name = a["name"]
        is_leader = name == leader
        metrics = t.get("metrics") or {}
        step_label = f"Step {step} · " if step is not None else ""
        title = f"{step_label}Team {team_no:02d} {'✓' if success else '✗'} · {name}{' ★ leader' if is_leader else ''} · {theorem}"
        stamps = [s["timestamp"] for s in a["steps"] if s.get("timestamp")]
        tool_kinds = {tc["tool_name"]: TOOL_KINDS.get(tc["tool_name"], "other")
                      for s in a["steps"] for tc in s.get("tool_calls", [])}
        model = next((s.get("model") for s in a["steps"] if s.get("model")), None)
        record = {
            "schema_version": SCHEMA_VERSION,
            "trace_id": f"{sid}:{name}",
            "session_id": sid,
            "timestamp_start": min(stamps) if stamps else None,
            "timestamp_end": max(stamps) if stamps else None,
            "task": {"description": title, "source": "rltracer-team"},
            "agent": {"name": name, "model": model},
            "steps": a["steps"],
            "outcome": {
                "success": success,
                "reward": (t.get("rewards") or {}).get("success", {}).get("score"),
                "reward_source": "fixed leader's Lean proof",
                "description": f"team {'solved' if success else 'did not solve'} {theorem}; "
                               f"this agent {'did' if metrics.get('individual_correct') else 'did not'} verify a proof",
            },
            "metrics": {
                "total_steps": len(a["steps"]),
                "total_input_tokens": sum((s.get("token_usage") or {}).get("input_tokens", 0) for s in a["steps"]),
                "total_output_tokens": sum((s.get("token_usage") or {}).get("output_tokens", 0) for s in a["steps"]),
            },
            "metadata": {
                "team": {"id": sid, "members": members, "leader": leader, "agent": name,
                         "success": success, "step": step, "team_number": team_no},
                "agent_messages": links[name],
                "step_timing": a["step_timing"],
                "tool_timing": a["tool_timing"],
                "tool_kinds": tool_kinds,
                "source_metrics": {k: metrics.get(k) for k in (
                    "individual_correct", "team_success", "voluntary_messages", "direct_messages",
                    "broadcasts", "tool_calls", "inbox_reads", "message_interrupt_count")},
            },
        }
        step_prefix = f"step{step:02d}_" if step is not None else ""
        filename = f"{step_prefix}team{team_no:02d}_{rank}_{re.sub(r'[^A-Za-z0-9_.-]', '_', name)}.json"
        out.append((filename, record))
    return out, {**stats, "theorem": theorem, "success": success, "members": members}


def short_model(model: Optional[str]) -> Optional[str]:
    """The source records a local snapshot path; keep just the model name."""
    if not model:
        return None
    m = re.search(r"models--([^/]+)--([^/]+)", model)
    return m.group(2) if m else os.path.basename(model.rstrip("/"))


# ===========================================================================
# CLI
# ===========================================================================

def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0], formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("inputs", nargs="+", help="release .zip, step_XX.jsonl, or team .json files (globs ok)")
    ap.add_argument("--step", type=int, help="rollout step to read from a zip (e.g. 1)")
    ap.add_argument("--split", default="all", choices=["all", "effective"], help="zip folder (default: all)")
    ap.add_argument("-n", "--limit", type=int, help="convert at most this many teams")
    ap.add_argument("--teams", type=int, nargs="+",
                    help="convert only these teams, by 1-based position in each input (e.g. --teams 2 9 16)")
    ap.add_argument("-o", "--output-dir", default=DEFAULT_OUTPUT, help=f"output folder (default: {DEFAULT_OUTPUT})")
    args = ap.parse_args()

    paths = [p for pattern in args.inputs for p in (sorted(glob.glob(pattern)) or [pattern])]
    os.makedirs(args.output_dir, exist_ok=True)
    wanted = set(args.teams or [])
    converted = 0
    for path in paths:
        # A team's number is its position in the input, so it can be found in the source.
        for team_no, (sid, traces, step) in enumerate(read_teams(path, args.step, args.split), 1):
            if args.limit is not None and converted >= args.limit:
                break
            if wanted and team_no not in wanted:
                if team_no > max(wanted):
                    break
                continue
            converted += 1
            files, stats = convert_team(sid, traces, step, team_no)
            for filename, record in files:
                with open(os.path.join(args.output_dir, filename), "w", encoding="utf-8") as f:
                    json.dump(record, f, ensure_ascii=False)
            print(f"{f'step {step} ' if step is not None else ''}team {team_no:02d} {'✓' if stats['success'] else '✗'} {stats['theorem']}: "
                  f"{len(files)} agents, {stats['messages']} messages, "
                  f"{stats['matched']}/{stats['reads']} reads matched"
                  + (f", {stats['out_of_order']} read before sent!" if stats["out_of_order"] else ""))
    print(f"wrote {converted} teams to {os.path.relpath(args.output_dir)}")


if __name__ == "__main__":
    main()
