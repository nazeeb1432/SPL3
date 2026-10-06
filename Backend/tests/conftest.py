"""Shared fixtures for the API endpoint tests.

These are black-box tests: they talk to a running backend over HTTP/WebSocket
(start Redis and `python app.py` first, see docs/SETUP.md). Nothing is mocked.

    cd Backend && source venv/bin/activate
    pytest tests/ -v                 # everything
    pytest tests/ -v -m "not llm"    # skip tests that call OpenAI
"""
import json
import os
import uuid
from pathlib import Path

import httpx
import pytest
import redis

BASE_URL = os.getenv("SHIELD_API_URL", "http://127.0.0.1:8001")
WS_URL = BASE_URL.replace("http", "ws", 1)
RESULTS_FILE = Path(__file__).parent / "_results.json"

# One id per run so repeated runs never collide in filters.db
RUN_ID = uuid.uuid4().hex[:8]

_actuals = {}
_outcomes = {}


def pytest_configure(config):
    config.addinivalue_line("markers", "llm: test makes a real LLM API call")
    config.addinivalue_line("markers", "tc(id): test case id used in the report")


@pytest.fixture(scope="session")
def client():
    with httpx.Client(base_url=BASE_URL, timeout=120.0) as c:
        try:
            c.get("/ping")
        except httpx.HTTPError as e:
            pytest.exit(f"Backend not reachable at {BASE_URL}: {e}", returncode=2)
        yield c


@pytest.fixture
def user_id(request):
    """A fresh user id per test."""
    return f"pytest_{RUN_ID}_{request.node.name}"[:60]


@pytest.fixture(scope="session")
def redis_client():
    r = redis.Redis(host="localhost", port=6379)
    try:
        r.ping()
    except redis.RedisError as e:
        pytest.skip(f"Redis not reachable: {e}")
    return r


@pytest.fixture
def record(request):
    """Store what the server actually returned, keyed by test case id."""
    marker = request.node.get_closest_marker("tc")
    tc_id = marker.args[0] if marker else request.node.name

    def _record(response=None, note=None):
        if response is not None:
            try:
                body = response.json()
            except ValueError:
                body = response.text
            body = json.dumps(body, default=str)
            if len(body) > 300:
                body = body[:300] + "..."
            _actuals[tc_id] = f"HTTP {response.status_code} {body}"
        if note:
            _actuals[tc_id] = (_actuals.get(tc_id, "") + " " + note).strip()

    return _record


@pytest.fixture
def make_filter(client):
    """Create a filter through the API and return its id."""
    def _make(user_id, text="spiders", intensity=3, content_type="all", duration="permanent"):
        r = client.post("/filters", json={
            "user_id": user_id, "filter_text": text, "intensity": intensity,
            "content_type": content_type, "duration": duration,
        })
        assert r.status_code == 200, r.text
        return r.json()["filter_id"]
    return _make


@pytest.hookimpl(hookwrapper=True)
def pytest_runtest_makereport(item, call):
    outcome = yield
    report = outcome.get_result()
    marker = item.get_closest_marker("tc")
    tc_id = marker.args[0] if marker else item.name
    if report.when == "call" or (report.when == "setup" and report.outcome != "passed"):
        _outcomes[tc_id] = {
            "test": item.name,
            "outcome": report.outcome,
            "duration": round(report.duration, 2),
            "error": str(report.longrepr).splitlines()[-1] if report.failed else "",
        }


def pytest_sessionfinish(session, exitstatus):
    merged = {
        tc: {**info, "actual": _actuals.get(tc, "")}
        for tc, info in sorted(_outcomes.items())
    }
    RESULTS_FILE.write_text(json.dumps(merged, indent=2))
