import json

import pytest

from stagerai import (
    StagerAI,
    StagerApiError,
    StagerProcessingError,
    construct_webhook_event,
    content_type_for,
    is_valid_webhook_signature,
    sign_webhook,
)


class FakeResponse:
    def __init__(self, status=200, body=None):
        self.status_code = status
        self.ok = 200 <= status < 300
        self.content = b"" if body is None else json.dumps(body).encode()
        self.text = self.content.decode()

    def json(self):
        return json.loads(self.content)


class FakeSession:
    """Answers from a list of (method, url substring, response or callable)."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def request(self, method, url, **kwargs):
        self.calls.append({"method": method, "url": url, **kwargs})
        for m, part, respond in self.routes:
            if m == method and part in url:
                return respond(kwargs) if callable(respond) else respond
        raise AssertionError(f"Unexpected request {method} {url}")

    def put(self, url, **kwargs):
        return self.request("PUT", url, **kwargs)


def ok(data):
    return FakeResponse(body={"status": "success", "data": data})


def test_sends_key_and_unwraps_envelope():
    s = FakeSession([("POST", "/api/projects", ok({"id": "p1", "title": "123 Main St"}))])
    stager = StagerAI(api_key="k", session=s)
    assert stager.projects.create("123 Main St") == {"id": "p1", "title": "123 Main St"}
    assert s.calls[0]["headers"]["stager-api-key"] == "k"
    assert s.calls[0]["url"] == "https://api.stagerai.com/api/projects"
    assert s.calls[0]["json"] == {"title": "123 Main St"}


def test_reads_key_from_env(monkeypatch):
    monkeypatch.setenv("STAGER_API_KEY", "env-key")
    assert StagerAI(session=FakeSession([])).api_key == "env-key"


def test_api_error():
    s = FakeSession([("POST", "/api/hdr-upload-url", FakeResponse(400, {"message": "group already enhanced"}))])
    stager = StagerAI(api_key="k", session=s)
    with pytest.raises(StagerApiError) as e:
        stager.hdr.get_group_upload_url("g1", "a.jpg")
    assert e.value.status == 400
    assert str(e.value) == "group already enhanced"


def test_process_bracket(tmp_path):
    raw = tmp_path / "b.CR3"
    raw.write_bytes(b"raw")
    polls = {"n": 0}

    def group_status(_):
        polls["n"] += 1
        return ok({"status": "processing"} if polls["n"] < 2 else {"status": "completed", "imageUrl": "https://out.jpg"})

    s = FakeSession(
        [
            ("POST", "/api/hdr-image-group", ok({"groupId": "g1"})),
            ("POST", "/api/hdr-upload-url", lambda kw: ok({"id": "r", "uploadUrl": "https://storage.example/" + kw["json"]["filename"]})),
            ("PUT", "https://storage.example/", FakeResponse()),
            ("POST", "/api/hdr-enhance", ok({})),
            ("GET", "/api/hdr-image-group/g1", group_status),
        ]
    )
    stager = StagerAI(api_key="k", session=s)
    result = stager.hdr.process_bracket(
        "p1", [("a.jpg", b"jpg"), str(raw)], tv_logo_id="tv1", format="png", interval=0, sky_replacement=False
    )
    assert result["imageUrl"] == "https://out.jpg"
    assert result["groupId"] == "g1"

    create = next(c for c in s.calls if c["url"].endswith("/api/hdr-image-group"))
    assert create["json"] == {"projectId": "p1", "skyReplacement": False}
    puts = [c for c in s.calls if c["method"] == "PUT"]
    assert puts[0]["headers"] == {"content-type": "image/jpeg"}
    assert puts[1]["headers"] == {}
    assert puts[1]["data"] == b"raw"
    enhance = next(c for c in s.calls if c["url"].endswith("/api/hdr-enhance"))
    assert enhance["json"] == {"groupId": "g1", "tvLogoId": "tv1"}
    assert s.calls[-1]["params"] == {"format": "png"}


def test_unknown_hdr_option_is_rejected():
    stager = StagerAI(api_key="k", session=FakeSession([]))
    with pytest.raises(TypeError):
        stager.hdr.create_group("p1", skyReplacement=True)


def test_wait_for_group_error_code():
    s = FakeSession([("GET", "/api/hdr-image-group/g1", ok({"status": "error", "code": 11, "errorMessage": "Failed to align"}))])
    stager = StagerAI(api_key="k", session=s)
    with pytest.raises(StagerProcessingError) as e:
        stager.hdr.wait_for_group("g1")
    assert e.value.code == 11


def test_wait_for_batch():
    polls = {"n": 0}

    def batch(_):
        polls["n"] += 1
        done = polls["n"] >= 2
        return ok(
            {
                "processing": not done,
                "status": "processing",
                "results": [
                    {"groupId": "g1", "imageUrl": "https://1.jpg"},
                    {"groupId": "g2", "status": "error", "code": 1} if done else {"groupId": "g2", "processing": True},
                ],
            }
        )

    stager = StagerAI(api_key="k", session=FakeSession([("GET", "/api/hdr-batch/b1", batch)]))
    result = stager.hdr.wait_for_batch("b1", interval=0)
    assert polls["n"] == 2
    assert result["results"][1]["code"] == 1


def test_stage_and_wait():
    s = FakeSession(
        [
            ("POST", "/api/images/img1/stage", ok({"generationId": "gen1", "status": "processing"})),
            ("GET", "/api/generations/gen1", ok({"generationId": "gen1", "status": "completed", "imageUrl": "https://staged.jpg"})),
        ]
    )
    stager = StagerAI(api_key="k", session=s)
    gen = stager.edits.stage("img1", room_type="LIVING_ROOM", room_style="modern", color_types=["classicWhite"])
    assert s.calls[0]["json"] == {"roomType": "LIVING_ROOM", "roomStyle": "modern", "colorTypes": ["classicWhite"]}
    assert stager.edits.wait(gen["generationId"])["imageUrl"] == "https://staged.jpg"


def test_image_upload_multipart():
    s = FakeSession([("POST", "/api/image", FakeResponse(body={"success": True, "data": {"id": "img1"}}))])
    stager = StagerAI(api_key="k", session=s)
    assert stager.images.upload(("room.jpg", b"x"))["id"] == "img1"
    assert s.calls[0]["files"] == {"file": ("room.jpg", b"x")}


def test_video_clip_order():
    s = FakeSession([("POST", "/api/videos/v1/clips", FakeResponse(body={"data": {"id": "c1"}}))])
    stager = StagerAI(api_key="k", session=s)
    assert stager.videos.add_clip("v1", ["a", "b"], effect=1)["id"] == "c1"
    assert s.calls[0]["json"] == {"images": [{"id": "a", "order": 0}, {"id": "b", "order": 1}], "effect": 1}


def test_webhooks():
    body = json.dumps({"eventId": "e1", "eventType": "edit.completed", "data": {}})
    ts = "1700000000000"
    headers = {"X-Stager-Signature": sign_webhook(body, ts, "secret"), "X-Stager-Timestamp": ts}
    now = 1700000000000 + 1000
    assert is_valid_webhook_signature(body, headers, "secret", now_ms=now)
    assert not is_valid_webhook_signature(body, headers, "wrong", now_ms=now)
    assert not is_valid_webhook_signature(body + " ", headers, "secret", now_ms=now)
    assert not is_valid_webhook_signature(body, headers, "secret", now_ms=now + 10 * 60_000)
    lower = {k.lower(): v for k, v in headers.items()}
    assert construct_webhook_event(body.encode(), lower, "secret", now_ms=now)["eventId"] == "e1"


def test_content_type_for():
    assert content_type_for("x.JPEG") == "image/jpeg"
    assert content_type_for("x.nef") is None
