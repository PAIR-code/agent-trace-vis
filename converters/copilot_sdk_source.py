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

"""Reader for Copilot SDK event logs, used by convert_copilot_chat.py."""

import datetime as dt
import json
import os
import re
from dataclasses import dataclass
from typing import Dict, List, Optional


@dataclass
class SdkSession:
    session_id: str
    events_path: str
    modified_at: float


def discover_sdk_sessions(root: str) -> List[SdkSession]:
    """Find SDK event logs in a session-state directory or a single session folder."""
    if os.path.isfile(os.path.join(root, "events.jsonl")):
        paths = [os.path.join(root, "events.jsonl")]
    elif os.path.isdir(root):
        paths = []
        for name in os.listdir(root):
            path = os.path.join(root, name, "events.jsonl")
            if os.path.isfile(path):
                paths.append(path)
    else:
        paths = []

    sessions = [
        SdkSession(
            session_id=os.path.basename(os.path.dirname(path)),
            events_path=path,
            modified_at=os.path.getmtime(path),
        )
        for path in paths
    ]
    return sorted(sessions, key=lambda session: session.modified_at, reverse=True)


def read_sdk_events(path: str) -> List[dict]:
    events = []
    with open(path, encoding="utf-8") as source:
        for line_number, line in enumerate(source, 1):
            if not line.strip():
                continue
            try:
                event = json.loads(line)
            except json.JSONDecodeError as error:
                raise ValueError(f"{path}:{line_number}: invalid JSON: {error}") from error
            if isinstance(event, dict):
                events.append(event)
    return events


def parse_arguments(value) -> dict:
    if isinstance(value, dict):
        return value
    if isinstance(value, str):
        try:
            parsed = json.loads(value)
            if isinstance(parsed, dict):
                return parsed
            return {"arguments": parsed}
        except json.JSONDecodeError:
            return {"arguments": value}
    return {}


def result_text(value) -> str:
    if value is None:
        return ""
    if isinstance(value, str):
        return value
    return json.dumps(value, ensure_ascii=False)


def event_timestamp(event: dict) -> Optional[str]:
    timestamp = event.get("timestamp")
    return timestamp if isinstance(timestamp, str) else None


def timestamp_seconds(timestamp: Optional[str]) -> Optional[float]:
    if not timestamp:
        return None
    try:
        return dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def _new_tool_call(name: str, call_id: Optional[str], arguments, timestamp: Optional[str]) -> dict:
    return {
        "id": call_id,
        "name": name or "tool",
        "input": parse_arguments(arguments),
        "result": "",
        "error": None,
        "started_at": timestamp,
        "duration_ms": None,
    }


def _call_for_event(
    calls_by_id: Dict[str, dict],
    message: Optional[dict],
    name: str,
    call_id: Optional[str],
    arguments,
    timestamp: Optional[str],
) -> dict:
    call = calls_by_id.get(call_id) if call_id else None
    if call is None:
        call = _new_tool_call(name, call_id, arguments, timestamp)
        if message is not None:
            message["tool_calls"].append(call)
        if call_id:
            calls_by_id[call_id] = call
    return call


def _set_call_duration(call: dict, timestamp: Optional[str]) -> None:
    start = timestamp_seconds(call.get("started_at"))
    end = timestamp_seconds(timestamp)
    if start is not None and end is not None:
        call["duration_ms"] = max(0, int(round((end - start) * 1000)))


def build_turns(events: List[dict], default_model: Optional[str] = None) -> List[dict]:
    """Convert event-log records to the neutral turns accepted by to_opentraces()."""
    segments = []
    current = None
    for event in events:
        if event.get("type") == "user.message":
            if current is not None:
                segments.append(current)
            current = [event]
        elif current is not None:
            current.append(event)
    if current is not None:
        segments.append(current)

    turns = []
    for segment in segments:
        user_event = segment[0]
        user_data = user_event.get("data") or {}
        user_text = user_data.get("content") or user_data.get("transformedContent") or ""
        if not isinstance(user_text, str):
            user_text = result_text(user_text)
        attachments = [
            item.get("displayName")
            for item in user_data.get("attachments") or []
            if isinstance(item, dict) and item.get("displayName")
        ]
        if attachments:
            user_text = "\n".join([user_text] + [f"[Attachment: {name}]" for name in attachments]).strip()

        turn = {
            "user": user_text,
            "timestamp": event_timestamp(user_event),
            "model": default_model,
            "token_usage": None,
            "messages": [],
        }
        calls_by_id: Dict[str, dict] = {}
        generation_start = turn["timestamp"]
        last_message = None
        usage_by_api_call: Dict[str, dict] = {}
        token_totals = {"input_tokens": 0, "output_tokens": 0}
        has_token_usage = False

        for event in segment[1:]:
            event_type = event.get("type")
            data = event.get("data") or {}
            timestamp = event_timestamp(event)

            if event_type == "session.usage_record":
                usage = data.get("usage") or {}
                api_call_id = usage.get("apiCallId")
                if api_call_id:
                    usage_by_api_call[api_call_id] = usage
                model = usage.get("model")
                if model and not turn["model"]:
                    turn["model"] = model
                for source_key, target_key in (
                    ("inputTokens", "input_tokens"),
                    ("outputTokens", "output_tokens"),
                ):
                    value = usage.get(source_key)
                    if isinstance(value, (int, float)) and value >= 0:
                        token_totals[target_key] += int(value)
                        has_token_usage = True
                continue

            if event_type == "assistant.turn_start":
                if timestamp:
                    generation_start = timestamp
                continue

            if event_type == "assistant.message":
                message_model = data.get("model")
                if message_model and not turn["model"]:
                    turn["model"] = message_model
                message = {
                    "content": data.get("content") or "",
                    "reasoning": data.get("reasoningText") or "",
                    "started_at": generation_start,
                    "timestamp": timestamp,
                    "model": message_model,
                    "tool_calls": [],
                }
                usage = usage_by_api_call.get(data.get("apiCallId"))
                if usage and isinstance(usage.get("reasoningTokens"), (int, float)):
                    message["reasoning_tokens"] = int(usage["reasoningTokens"])
                turn["messages"].append(message)
                last_message = message
                if timestamp:
                    generation_start = timestamp
                for request in data.get("toolRequests") or []:
                    if not isinstance(request, dict):
                        continue
                    call_id = request.get("toolCallId")
                    call = _new_tool_call(
                        request.get("name") or "tool",
                        call_id,
                        request.get("arguments"),
                        None,
                    )
                    message["tool_calls"].append(call)
                    if call_id:
                        calls_by_id[call_id] = call
                continue

            if event_type == "tool.execution_start":
                call_id = data.get("toolCallId")
                call = _call_for_event(
                    calls_by_id, last_message, data.get("toolName") or "tool",
                    call_id, data.get("arguments"), timestamp,
                )
                if timestamp:
                    call["started_at"] = timestamp
                if not call["input"] and data.get("arguments") is not None:
                    call["input"] = parse_arguments(data["arguments"])
                continue

            if event_type == "tool.execution_complete":
                call_id = data.get("toolCallId")
                call = calls_by_id.get(call_id) if call_id else None
                if call:
                    result = data.get("result") or {}
                    call["result"] = result_text(
                        result.get("content") or result.get("detailedContent")
                        if isinstance(result, dict) else result
                    )
                    if data.get("success") is False:
                        call["error"] = result_text(data.get("error")) or "tool failed"
                    _set_call_duration(call, timestamp)
                    if timestamp:
                        generation_start = timestamp
                continue

        if has_token_usage:
            turn["token_usage"] = token_totals
        turns.append(turn)
    return turns


def convert_sdk_session(
    session: SdkSession,
    events: List[dict],
    output_dir: str,
    scrub_home: bool,
    *,
    to_opentraces,
    tool_kind_for_name,
) -> Optional[str]:
    if not any(event.get("type") == "user.message" for event in events):
        return None

    start_event = next((event for event in events if event.get("type") == "session.start"), {})
    start_data = start_event.get("data") or {}
    context = start_data.get("context") or {}
    trace_id = start_data.get("sessionId") or session.session_id
    model = start_data.get("selectedModel")
    if model == "auto":
        model = None
    turns = build_turns(events, model)
    if not turns:
        return None

    agent = {
        "name": "copilot-sdk",
        "version": str(start_data.get("copilotVersion") or start_data.get("version") or "unknown"),
    }
    used_model = next((turn.get("model") for turn in turns if turn.get("model")), None)
    if used_model:
        agent["model"] = used_model
    workspace = context.get("cwd") or context.get("gitRoot")
    metadata = {
        "source": "copilot-sdk",
        "source_format": "events.jsonl",
        "source_file": session.events_path,
        "workspace_folder": workspace,
        "repository": context.get("repository"),
        "producer": start_data.get("producer"),
        "tool_kinds": {},
    }
    tool_kinds = metadata["tool_kinds"]
    for turn in turns:
        for message in turn["messages"]:
            for call in message["tool_calls"]:
                tool_kinds[call["name"]] = tool_kind_for_name(call["name"])

    title = f"Copilot SDK session {trace_id[:8]}"
    record = to_opentraces(
        turns,
        trace_id=trace_id,
        title=title,
        agent=agent,
        metadata=metadata,
    )

    output = json.dumps(record, indent=2, ensure_ascii=False)
    if scrub_home:
        home = os.path.expanduser("~")
        output = output.replace(home, "~").replace(json.dumps(home)[1:-1], "~")

    os.makedirs(output_dir, exist_ok=True)
    safe_id = re.sub(r"[^A-Za-z0-9._-]+", "_", trace_id)
    output_path = os.path.join(output_dir, f"copilot_sdk_{safe_id}.json")
    with open(output_path, "w", encoding="utf-8") as destination:
        destination.write(output)

    tool_count = sum(len(step.get("tool_calls") or []) for step in record["steps"])
    print(
        f"  ✓ {trace_id[:8]}  {len(turns)} turns, {len(record['steps'])} steps, "
        f"{tool_count} tool calls -> {output_path}"
    )
    return output_path
