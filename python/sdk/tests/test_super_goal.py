"""Pin Python SDK preservation of the recorded SuperGoal lifecycle."""

from __future__ import annotations

import json
import sys
from pathlib import Path

from deepseek_harness import DeepSeekHarness


def test_run_preserves_recorded_super_goal_changes(tmp_path: Path) -> None:
    repository = Path(__file__).resolve().parents[3]
    fixture = repository / "snapshots" / "sdk" / "super-goal" / "session.v2.jsonl"
    records = [json.loads(line) for line in fixture.read_text(encoding="utf-8").splitlines() if line.strip()]
    changes = [record for record in records if record.get("type") == "super-goal/change"]
    assert changes, "The real SDK snapshot must contain the SuperGoal lifecycle"
    event_file = tmp_path / "changes.json"
    event_file.write_text(json.dumps(changes), encoding="utf-8")
    runtime = tmp_path / "wire_fixture.py"
    runtime.write_text(
        '''import json
import sys

changes = json.load(open(sys.argv[1], encoding="utf-8"))
def write(value):
    print(json.dumps({"jsonrpc": "2.0", **value}), flush=True)
def event(session, value):
    write({"method": "session.event", "params": {"sessionId": session, "event": value}})
for line in sys.stdin:
    request = json.loads(line)
    method = request["method"]
    if method == "initialize":
        write({"id": request["id"], "result": {"serverInfo": {"name": "wire-fixture"}}})
    elif method == "session/prompt":
        session = request["params"]["sessionId"]
        event(session, {"type": "agent/inbox/spliced", "data": {"target": "next-turn", "start": 0, "inserted": [{"id": "input"}]}})
        write({"method": "session.status", "params": {"sessionId": session, "status": "running"}})
        write({"id": request["id"], "result": {"messageId": "input"}})
        for change in changes:
            event(session, change)
        event(session, {"type": "assistant/message", "data": {"message": {"role": "assistant", "content": [{"type": "text", "text": "SUPERGOAL COMPLETE"}]}}})
        event(session, {"type": "turn/end", "data": {"turn": 1, "reason": {"kind": "completed"}}})
        write({"method": "session.status", "params": {"sessionId": session, "status": "idle"}})
    elif method == "shutdown":
        write({"id": request["id"], "result": {}})
        break
''',
        encoding="utf-8",
    )
    with DeepSeekHarness(_launch_args=(sys.executable, str(runtime), str(event_file))) as harness:
        result = harness.run("Continue SuperGoal", session_id="super-goal")
    actual = {
        "final_response": result.final_response,
        "finish_reason": result.finish_reason,
        "changes": [
            {"type": event["type"], "data": event["data"]}
            for event in result.events
            if event.get("type") == "super-goal/change"
        ],
    }
    expected = Path(__file__).with_name("snapshots") / "super-goal.expected.json"
    assert actual == json.loads(expected.read_text(encoding="utf-8"))
