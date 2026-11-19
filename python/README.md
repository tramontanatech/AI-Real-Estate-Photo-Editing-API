# stagerai: Python SDK for the Stager AI Real Estate Photo Editing API

[![PyPI](https://img.shields.io/pypi/v/stagerai.svg)](https://pypi.org/project/stagerai/)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/tramontanatech/AI-Real-Estate-Photo-Editing-API/blob/main/LICENSE)

Official Python client for the [Stager AI API](https://stagerai.com/api-docs). Automate **HDR bracket merging**, **lens and perspective correction**, **window pulls**, **virtual staging**, **virtual renovation**, **sky replacement (day to dusk)**, **lawn replacement**, **decluttering** and **listing videos** for real estate photos.

![HDR real estate photo edited with the Stager AI API: brick house with a double garage](https://cdn.stagerai.com/assets/real-estate-brick-house-double-garage-ebee98af.webp)

## Install

```bash
pip install stagerai
```

Python 3.9+. Get an API key from [stagerai.com/api-docs](https://stagerai.com/api-docs) and set it as `STAGER_API_KEY`.

## Merge HDR brackets

```python
from stagerai import StagerAI

stager = StagerAI()  # reads STAGER_API_KEY

project = stager.projects.create("123 Main Street")
result = stager.hdr.process_bracket(
    project["id"],
    ["living_ev-2.CR3", "living_ev0.CR3", "living_ev+2.CR3"],
    lens_correction=True,
    perspective_correction=True,
    sky_replacement=True,
)
print(result["imageUrl"])
```

## Edit a whole listing at once (automatic bracket grouping)

```python
from pathlib import Path

photos = sorted(Path("shoot/").glob("*.jpg"))
batch = stager.hdr.process_batch(project["id"], photos, lawn_replacement=True)

for r in batch["results"]:
    print(r["filename"], r.get("imageUrl") or r.get("errorMessage"))
```

## Virtual staging, renovation, sky and lawn replacement

```python
image = stager.images.upload("empty_living_room.jpg")

gen = stager.edits.stage(
    image["id"],
    room_type="LIVING_ROOM",
    room_style="scandinavian",
    color_types=["classicWhite", "naturalWood"],
)
print(stager.edits.wait(gen["generationId"])["imageUrl"])

stager.edits.sky_replace(image["id"], sky_type="twilight", sky_sub_type="dramatic")
stager.edits.lawn_replace(image["id"], lawn_type="medium")
stager.edits.renovate(image["id"], room_type="KITCHEN", room_style="modern")
stager.edits.declutter(image["id"])
```

The `groupId` of a finished HDR photo is also its `imageId`, so you can stage or twilight an HDR result without uploading it again.

## Listing videos

```python
from stagerai import VideoEffect

video = stager.videos.create(orientation="horizontal", title="123 Main St tour")
stager.videos.add_clip(video["id"], [image["id"]], effect=VideoEffect.SLOW_MOTION_WALKTHROUGH)
stager.videos.render(video["id"])
print(stager.videos.wait_for_render(video["id"])["url"])
```

## Webhooks

```python
from stagerai import construct_webhook_event

event = construct_webhook_event(request.get_data(), request.headers, WEBHOOK_SECRET)
if event["eventType"] == "hdr.image.completed":
    print(event["data"]["imageUrl"])
```

## Errors

| Exception | When |
| --- | --- |
| `StagerApiError` | The API answered with a 4xx or 5xx (`.status`, `.body`) |
| `StagerProcessingError` | An HDR group, edit or render failed (`.code` is the HDR error code) |
| `StagerTimeoutError` | A `wait_*` helper ran out of time |

Full docs, pricing and every endpoint: **[stagerai.com/api-docs](https://stagerai.com/api-docs)**. More examples: [GitHub](https://github.com/tramontanatech/AI-Real-Estate-Photo-Editing-API).
