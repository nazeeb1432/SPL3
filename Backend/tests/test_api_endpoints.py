"""API endpoint tests for the routes the browser extension uses.

Each test carries a `tc` marker with the test case id used in the technical report.
Tests marked `llm` make real OpenAI calls and need a valid OPENAI_API_KEY.
"""
import io
import json
from datetime import datetime, timedelta

import pytest
from PIL import Image
from websockets.sync.client import connect

from conftest import RUN_ID, WS_URL

MARKERS = ("__BLUR_START__", "__OVERLAY_START__", "__REWRITE_START__")

REDDIT_URL = "https://www.reddit.com/svc/shreddit/feeds/home-feed"


def reddit_feed(*posts):
    """Minimal feed in the structure RedditProcessor parses (shreddit-post elements)."""
    return "".join(
        f'<shreddit-post id="t3_{i}" post-title="{title}">'
        f'<a slot="title">{title}</a><a slot="text-body">{body}</a>'
        f"</shreddit-post>"
        for i, (title, body) in enumerate(posts)
    )


def feed_request(user_id, html, url=REDDIT_URL):
    return {"user_id": user_id, "url": url, "data": {"feed_info": {"response": html}}}


def list_filters(client, user_id):
    r = client.get("/filters", params={"user_id": user_id})
    assert r.status_code == 200, r.text
    return r.json()["filters"]


def png_bytes():
    buf = io.BytesIO()
    Image.new("RGB", (64, 64), (200, 30, 30)).save(buf, format="PNG")
    return buf.getvalue()


# --------------------------------------------------------------------------- #
# Health check and CORS
# --------------------------------------------------------------------------- #

@pytest.mark.tc("TC-01")
def test_ping_returns_success(client, record):
    r = client.get("/ping")
    record(r)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert body["message"] == "DIY-MOD server is running"
    datetime.fromisoformat(body["timestamp"])


@pytest.mark.tc("TC-02")
def test_preflight_allows_private_network(client, record):
    r = client.options("/filters", headers={
        "Origin": "https://www.reddit.com",
        "Access-Control-Request-Method": "POST",
    })
    record(note=f"HTTP {r.status_code} allow-origin={r.headers.get('access-control-allow-origin')} "
                f"allow-private-network={r.headers.get('access-control-allow-private-network')}")
    assert r.status_code == 200
    assert r.headers["access-control-allow-private-network"] == "true"
    assert r.headers["access-control-allow-origin"] == "https://www.reddit.com"


@pytest.mark.tc("TC-03")
def test_every_response_has_private_network_header(client, record):
    r = client.get("/ping")
    record(note=f"HTTP {r.status_code} allow-private-network={r.headers.get('access-control-allow-private-network')}")
    assert r.headers.get("access-control-allow-private-network") == "true"


# --------------------------------------------------------------------------- #
# /filters CRUD
# --------------------------------------------------------------------------- #

@pytest.mark.tc("TC-04")
def test_get_filters_new_user_is_empty(client, user_id, record):
    r = client.get("/filters", params={"user_id": user_id})
    record(r)
    assert r.status_code == 200
    assert r.json() == {"status": "success", "message": "Found 0 filters", "filters": []}


@pytest.mark.tc("TC-05")
def test_get_filters_requires_user_id(client, record):
    r = client.get("/filters")
    record(r)
    assert r.status_code == 422


@pytest.mark.tc("TC-06")
def test_create_permanent_filter(client, user_id, record):
    r = client.post("/filters", json={
        "user_id": user_id, "filter_text": "spiders", "intensity": 4,
        "content_type": "image", "duration": "permanent",
    })
    record(r)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert isinstance(body["filter_id"], int)


@pytest.mark.tc("TC-07")
def test_created_filter_is_listed_with_its_fields(client, user_id, make_filter, record):
    filter_id = make_filter(user_id, text="spiders", intensity=4, content_type="image")
    r = client.get("/filters", params={"user_id": user_id})
    record(r)
    filters = r.json()["filters"]
    assert len(filters) == 1
    f = filters[0]
    assert f["id"] == filter_id
    assert f["filter_text"] == "spiders"
    assert f["intensity"] == 4
    assert f["content_type"] == "image"
    assert f["is_temporary"] is False
    assert f["expires_at"] is None


@pytest.mark.tc("TC-08")
def test_create_day_filter_expires_in_24_hours(client, user_id, make_filter, record):
    make_filter(user_id, text="election news", duration="day")
    r = client.get("/filters", params={"user_id": user_id})
    record(r)
    f = r.json()["filters"][0]
    assert f["is_temporary"] is True
    delta = datetime.fromisoformat(f["expires_at"]) - datetime.now()
    assert timedelta(hours=23, minutes=55) < delta <= timedelta(hours=24)


@pytest.mark.tc("TC-09")
def test_create_week_filter_expires_in_7_days(client, user_id, make_filter, record):
    make_filter(user_id, text="election news", duration="week")
    r = client.get("/filters", params={"user_id": user_id})
    record(r)
    f = r.json()["filters"][0]
    assert f["is_temporary"] is True
    delta = datetime.fromisoformat(f["expires_at"]) - datetime.now()
    assert timedelta(days=6, hours=23) < delta <= timedelta(days=7)


@pytest.mark.tc("TC-10")
def test_create_filter_requires_filter_text(client, user_id, record):
    r = client.post("/filters", json={"user_id": user_id, "intensity": 3})
    record(r)
    assert r.status_code == 422


@pytest.mark.tc("TC-11")
def test_create_filter_rejects_non_integer_intensity(client, user_id, record):
    r = client.post("/filters", json={"user_id": user_id, "filter_text": "spiders", "intensity": "high"})
    record(r)
    assert r.status_code == 422


@pytest.mark.tc("TC-12")
def test_create_filter_rejects_intensity_outside_1_to_5(client, user_id, record):
    r = client.post("/filters", json={"user_id": user_id, "filter_text": "spiders", "intensity": 99})
    record(r)
    assert r.status_code == 422


@pytest.mark.tc("TC-13")
def test_unknown_content_type_falls_back_to_all(client, user_id, record):
    r = client.post("/filters", json={
        "user_id": user_id, "filter_text": "spiders", "intensity": 3, "content_type": "video",
    })
    assert r.status_code == 200, r.text
    r = client.get("/filters", params={"user_id": user_id})
    record(r)
    assert r.json()["filters"][0]["content_type"] == "all"


@pytest.mark.tc("TC-14")
def test_update_filter_changes_text_and_intensity(client, user_id, make_filter, record):
    filter_id = make_filter(user_id, text="spiders", intensity=2, content_type="all")
    r = client.put(f"/filters/{filter_id}", json={
        "user_id": user_id, "filter_text": "spiders and insects", "intensity": 5, "content_type": "text",
    })
    record(r)
    assert r.status_code == 200
    assert r.json() == {"status": "success", "message": "Filter updated successfully"}
    f = list_filters(client, user_id)[0]
    assert (f["filter_text"], f["intensity"], f["content_type"]) == ("spiders and insects", 5, "text")


@pytest.mark.tc("TC-15")
def test_update_unknown_filter_returns_404(client, user_id, record):
    r = client.put("/filters/99999999", json={"user_id": user_id, "filter_text": "x", "intensity": 3})
    record(r)
    assert r.status_code == 404


@pytest.mark.tc("TC-16")
def test_update_other_users_filter_is_refused(client, user_id, make_filter, record):
    filter_id = make_filter(user_id, text="spiders")
    r = client.put(f"/filters/{filter_id}", json={
        "user_id": user_id + "_other", "filter_text": "hijacked", "intensity": 1,
    })
    record(r)
    assert list_filters(client, user_id)[0]["filter_text"] == "spiders"
    assert r.status_code == 404


@pytest.mark.tc("TC-17")
def test_update_rejects_non_integer_filter_id(client, user_id, record):
    r = client.put("/filters/abc", json={"user_id": user_id, "filter_text": "x", "intensity": 3})
    record(r)
    assert r.status_code == 422


@pytest.mark.tc("TC-18")
def test_delete_filter_removes_it_from_the_list(client, user_id, make_filter, record):
    filter_id = make_filter(user_id)
    r = client.delete(f"/filters/{filter_id}", params={"user_id": user_id})
    record(r)
    assert r.status_code == 200
    assert r.json() == {"status": "success", "message": "Filter deleted successfully"}
    assert list_filters(client, user_id) == []


@pytest.mark.tc("TC-19")
def test_delete_already_deleted_filter_returns_404(client, user_id, make_filter, record):
    filter_id = make_filter(user_id)
    assert client.delete(f"/filters/{filter_id}", params={"user_id": user_id}).status_code == 200
    r = client.delete(f"/filters/{filter_id}", params={"user_id": user_id})
    record(r)
    assert r.status_code == 404


@pytest.mark.tc("TC-20")
def test_delete_requires_user_id(client, user_id, make_filter, record):
    filter_id = make_filter(user_id)
    r = client.delete(f"/filters/{filter_id}")
    record(r)
    assert r.status_code == 422


@pytest.mark.tc("TC-21")
def test_delete_other_users_filter_is_refused(client, user_id, make_filter, record):
    filter_id = make_filter(user_id)
    r = client.delete(f"/filters/{filter_id}", params={"user_id": user_id + "_other"})
    record(r)
    assert len(list_filters(client, user_id)) == 1
    assert r.status_code == 404


# --------------------------------------------------------------------------- #
# /chat and /chat/image
# --------------------------------------------------------------------------- #

@pytest.mark.llm
@pytest.mark.tc("TC-22")
def test_chat_returns_structured_reply(client, user_id, record):
    r = client.post("/chat", json={
        "message": "I do not want to see pictures of spiders", "history": [], "user_id": user_id,
    })
    record(r)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert body["user_id"] == user_id
    assert isinstance(body["text"], str) and body["text"]
    assert body["type"] in ("clarify", "ready_for_config", "complete", "initial")
    assert isinstance(body["options"], list)


@pytest.mark.llm
@pytest.mark.tc("TC-23")
def test_chat_asks_to_clarify_gibberish(client, user_id, record):
    r = client.post("/chat", json={"message": "xkcdqwrtz bbbbnnn", "history": [], "user_id": user_id})
    record(r)
    assert r.status_code == 200
    assert r.json()["type"] == "clarify"


@pytest.mark.tc("TC-24")
def test_chat_requires_message(client, user_id, record):
    r = client.post("/chat", json={"history": [], "user_id": user_id})
    record(r)
    assert r.status_code == 422


@pytest.mark.tc("TC-25")
def test_chat_rejects_history_that_is_not_a_list(client, user_id, record):
    r = client.post("/chat", json={"message": "spiders", "history": "none", "user_id": user_id})
    record(r)
    assert r.status_code == 422


@pytest.mark.llm
@pytest.mark.tc("TC-26")
def test_chat_image_returns_structured_reply(client, user_id, record):
    r = client.post(
        "/chat/image",
        files={"image": ("sample.png", png_bytes(), "image/png")},
        data={"message": "I want to filter images like this", "history": "[]", "user_id": user_id},
    )
    record(r)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert body["user_id"] == user_id
    assert isinstance(body["text"], str) and body["text"]
    assert "type" in body


@pytest.mark.llm
@pytest.mark.tc("TC-27")
def test_chat_image_tolerates_malformed_history(client, user_id, record):
    r = client.post(
        "/chat/image",
        files={"image": ("sample.png", png_bytes(), "image/png")},
        data={"message": "filter this", "history": "not-json", "user_id": user_id},
    )
    record(r)
    assert r.status_code == 200
    assert r.json()["status"] == "success"


@pytest.mark.tc("TC-28")
def test_chat_image_requires_image(client, user_id, record):
    r = client.post("/chat/image", data={"message": "no file attached", "user_id": user_id})
    record(r)
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# /get_feed
# --------------------------------------------------------------------------- #

@pytest.mark.tc("TC-29")
def test_feed_without_filters_is_returned_unchanged(client, user_id, record):
    html = reddit_feed(("Weekend hiking photos", "We walked the ridge trail on Saturday."))
    r = client.post("/get_feed", json=feed_request(user_id, html))
    record(r)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    out = body["feed"]["response"]
    assert "Weekend hiking photos" in out
    assert not any(m in out for m in MARKERS)


@pytest.mark.llm
@pytest.mark.tc("TC-30")
def test_feed_matching_a_text_filter_is_marked(client, user_id, make_filter, record):
    make_filter(user_id, text="spiders", intensity=3, content_type="text")
    html = reddit_feed(
        ("Found a huge spider in my bathroom", "This tarantula-sized spider was crawling up the wall."),
        ("Best pasta recipe", "Boil the pasta for nine minutes and add olive oil."),
    )
    r = client.post("/get_feed", json=feed_request(user_id, html))
    out = r.json()["feed"]["response"] if r.status_code == 200 else ""
    found = [m for m in MARKERS if m in out]
    record(note=f"HTTP {r.status_code} status={r.json().get('status')} markers in response: {found}")
    assert r.status_code == 200
    assert found, "expected a transformation marker in the matching post"
    assert "Best pasta recipe" in out


@pytest.mark.tc("TC-31")
def test_feed_with_no_posts_returns_empty_success(client, user_id, record):
    r = client.post("/get_feed", json=feed_request(user_id, "<div>no posts here</div>"))
    record(r)
    assert r.status_code == 200
    assert r.json()["status"] == "success"
    assert "no posts here" in r.json()["feed"]["response"]


@pytest.mark.tc("TC-32")
def test_feed_from_unsupported_platform_returns_400(client, user_id, record):
    r = client.post("/get_feed", json=feed_request(user_id, "<p>x</p>", url="https://www.facebook.com/feed"))
    record(r)
    assert r.status_code == 400


@pytest.mark.tc("TC-33")
def test_feed_without_feed_info_returns_400(client, user_id, record):
    r = client.post("/get_feed", json={"user_id": user_id, "url": REDDIT_URL, "data": {}})
    record(r)
    assert r.status_code == 400


@pytest.mark.tc("TC-34")
def test_feed_requires_user_id(client, record):
    r = client.post("/get_feed", json={"url": REDDIT_URL, "data": {"feed_info": {"response": ""}}})
    record(r)
    assert r.status_code == 422


# --------------------------------------------------------------------------- #
# /get_img_result and /get_img_base64
# --------------------------------------------------------------------------- #

def seed_image_cache(redis_client, image_url, filter_text, value):
    """Write a result the way ImageCacheManager stores it: key = image URL,
    value = JSON dict keyed by the normalised filter string ("spiders" -> "spiders.")."""
    redis_client.set(image_url, json.dumps({filter_text.lower() + ".": value}), ex=300)


@pytest.mark.tc("TC-35")
def test_img_result_unknown_image_is_not_found(client, record):
    r = client.get("/get_img_result", params={
        "img_url": f"https://example.com/{RUN_ID}/never-processed.jpg", "filters": '["spiders"]',
    })
    record(r)
    assert r.status_code == 200
    assert r.json() == {"status": "NOT FOUND"}


@pytest.mark.tc("TC-36")
def test_img_result_returns_cached_url(client, redis_client, record):
    img = f"https://example.com/{RUN_ID}/cached-url.jpg"
    seed_image_cache(redis_client, img, "spiders", "http://localhost:8001/temp/uploads/out.png")
    r = client.get("/get_img_result", params={"img_url": img, "filters": '["spiders"]'})
    record(r)
    assert r.status_code == 200
    assert r.json() == {"status": "COMPLETED", "processed_value": "http://localhost:8001/temp/uploads/out.png"}


@pytest.mark.tc("TC-37")
def test_img_result_includes_base64_when_cached(client, redis_client, record):
    img = f"https://example.com/{RUN_ID}/cached-b64.jpg"
    seed_image_cache(redis_client, img, "spiders", {
        "url": "http://localhost:8001/temp/uploads/out.png", "base64": "data:image/png;base64,AAAA",
    })
    r = client.get("/get_img_result", params={"img_url": img, "filters": '["spiders"]'})
    record(r)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "COMPLETED"
    assert body["processed_value"] == "http://localhost:8001/temp/uploads/out.png"
    assert body["base64_url"] == "data:image/png;base64,AAAA"


@pytest.mark.tc("TC-38")
def test_img_result_accepts_plain_string_filter(client, redis_client, record):
    img = f"https://example.com/{RUN_ID}/plain-filter.jpg"
    seed_image_cache(redis_client, img, "spiders", "http://localhost:8001/temp/uploads/out.png")
    r = client.get("/get_img_result", params={"img_url": img, "filters": "Spiders"})
    record(r)
    assert r.status_code == 200
    assert r.json()["status"] == "COMPLETED"


@pytest.mark.tc("TC-39")
def test_img_result_requires_both_parameters(client, record):
    r = client.get("/get_img_result", params={"img_url": "https://example.com/a.jpg"})
    record(r)
    assert r.status_code == 422


@pytest.mark.tc("TC-40")
def test_img_base64_passes_through_external_url(client, record):
    r = client.get("/get_img_base64", params={"img_url": "https://example.com/a.jpg"})
    record(r)
    assert r.status_code == 200
    assert r.json() == {"status": "success", "data_url": "https://example.com/a.jpg"}


@pytest.mark.tc("TC-41")
def test_img_base64_missing_local_file_reports_error(client, record):
    r = client.get("/get_img_base64", params={
        "img_url": f"http://localhost:8001/temp/uploads/{RUN_ID}-missing.png",
    })
    record(r)
    assert r.status_code == 200
    assert r.json() == {"status": "error", "message": "Image file not found"}


# --------------------------------------------------------------------------- #
# /user/update
# --------------------------------------------------------------------------- #

@pytest.mark.tc("TC-42")
def test_user_update_creates_user_with_email(client, user_id, record):
    r = client.post("/user/update", json={"user_id": user_id, "email": "first@example.com"})
    record(r)
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "success"
    assert body["user"] == {"id": user_id, "email": "first@example.com"}


@pytest.mark.tc("TC-43")
def test_user_update_changes_email(client, user_id, record):
    client.post("/user/update", json={"user_id": user_id, "email": "first@example.com"})
    r = client.post("/user/update", json={"user_id": user_id, "email": "second@example.com"})
    record(r)
    assert r.status_code == 200
    assert r.json()["user"]["email"] == "second@example.com"


@pytest.mark.tc("TC-44")
def test_user_update_requires_user_id(client, record):
    r = client.post("/user/update", json={"email": "nobody@example.com"})
    record(r)
    assert r.status_code == 400


@pytest.mark.tc("TC-45")
def test_user_update_rejects_malformed_json(client, record):
    r = client.post("/user/update", content=b"{not json", headers={"Content-Type": "application/json"})
    record(r)
    assert r.status_code in (400, 422)


# --------------------------------------------------------------------------- #
# WebSocket /ws/{user_id}
# --------------------------------------------------------------------------- #

@pytest.mark.tc("TC-46")
def test_ws_ping_gets_pong(client, user_id, record):
    with connect(f"{WS_URL}/ws/{user_id}", open_timeout=10) as ws:
        ws.send(json.dumps({"type": "ping"}))
        msg = json.loads(ws.recv(timeout=10))
    record(note=json.dumps(msg))
    assert msg["type"] == "pong"
    datetime.fromisoformat(msg["timestamp"])


@pytest.mark.tc("TC-47")
def test_ws_filter_update_pushes_current_filters(client, user_id, make_filter, record):
    make_filter(user_id, text="spiders")
    with connect(f"{WS_URL}/ws/{user_id}", open_timeout=10) as ws:
        ws.send(json.dumps({"type": "filter_update"}))
        msg = json.loads(ws.recv(timeout=10))
    record(note=json.dumps(msg)[:300])
    assert msg["type"] == "filters_updated"
    assert [f["filter_text"] for f in msg["data"]] == ["spiders"]


@pytest.mark.tc("TC-48")
def test_ws_wait_for_image_returns_cached_result(client, user_id, redis_client, record):
    img = f"https://example.com/{RUN_ID}/ws-cached.jpg"
    seed_image_cache(redis_client, img, "spiders", "http://localhost:8001/temp/uploads/out.png")
    with connect(f"{WS_URL}/ws/{user_id}", open_timeout=10) as ws:
        ws.send(json.dumps({"type": "wait_for_image", "data": {"image_url": img, "filters": ["spiders"]}}))
        msg = json.loads(ws.recv(timeout=10))
    record(note=json.dumps(msg)[:300])
    assert msg["type"] == "image_processed"
    assert msg["data"]["image_url"] == img
    assert msg["data"]["result"] == "http://localhost:8001/temp/uploads/out.png"


@pytest.mark.tc("TC-49")
def test_ws_ignores_unknown_message_type(client, user_id, record):
    with connect(f"{WS_URL}/ws/{user_id}", open_timeout=10) as ws:
        ws.send(json.dumps({"type": "no_such_type"}))
        ws.send(json.dumps({"type": "ping"}))
        msg = json.loads(ws.recv(timeout=10))
    record(note="connection stayed open; next message: " + json.dumps(msg))
    assert msg["type"] == "pong"
