# AI Real Estate Photo Editing API: HDR, Virtual Staging and Listing Videos

[![npm](https://img.shields.io/npm/v/stagerai.svg?label=npm%20stagerai)](https://www.npmjs.com/package/stagerai)
[![PyPI](https://img.shields.io/pypi/v/stagerai.svg?label=pypi%20stagerai)](https://pypi.org/project/stagerai/)
[![CI](https://github.com/tramontanatech/AI-Real-Estate-Photo-Editing-API/actions/workflows/ci.yml/badge.svg)](https://github.com/tramontanatech/AI-Real-Estate-Photo-Editing-API/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Official SDKs, examples and OpenAPI spec for the **[Stager AI API](https://stagerai.com/api-docs)**, an AI photo editing API for real estate photographers, media companies, brokerages and proptech platforms.

Send bracketed exposures or single photos, get back finished listing photos:

- **[HDR bracket merging](https://stagerai.com/auto-hdr)**: blends 1 to 7 exposures (RAW, JPEG, PNG or TIFF) into one balanced photo
- **[Lens and perspective correction](https://stagerai.com/real-estate-ai-perspective-correction)**: removes wide-angle distortion and straightens verticals
- **[Window pulls](https://stagerai.com/real-estate-ai-window-view-enhancer)**: recovers blown-out windows so the view outside shows
- **[Virtual staging](https://stagerai.com/virtual-staging-ai)**: furnishes empty rooms in 12 styles
- **[Virtual renovation](https://stagerai.com/real-estate-ai-home-renovation)**: new finishes, fixtures and furniture for dated rooms and exteriors
- **[Sky replacement](https://stagerai.com/real-estate-sky-replacement) and [day to dusk](https://stagerai.com/real-estate-day-to-dusk)**: blue skies or twilight
- **[Lawn replacement](https://stagerai.com/real-estate-lawn-replacement)**: patchy grass becomes a fresh lawn
- **[Decluttering](https://stagerai.com/real-estate-ai-decluttering)**: empties a room, ready to stage
- **[Listing videos](https://stagerai.com/real-estate-ai-video-from-photos-api)**: walkthroughs, before/after staging, day-to-night and more, from photos
- **Retouching**: photographer removal, [fire in the fireplace](https://stagerai.com/real-estate-fireplace-fire), [TV screen replacement](https://stagerai.com/real-estate-tv-screen-replacement), [license plate blur](https://stagerai.com/real-estate-license-plate-blur)

**$0.25 per photo**, the same price as the web app. A bracket group of up to 7 exposures counts as one photo.

## Sample output

Finished photos straight from the API: HDR merge, lens and perspective correction, window pull and sky replacement, with no manual retouching.

| | |
| --- | --- |
| ![Real estate HDR photo of a brick house with a double garage, edited by the Stager AI API](https://cdn.stagerai.com/assets/real-estate-brick-house-double-garage-ebee98af.webp) | ![Real estate HDR photo of a living room with a stone fireplace, edited by the Stager AI API](https://cdn.stagerai.com/assets/real-estate-living-room-stone-fireplace-697ee0c0.webp) |
| Exterior: HDR merge with blue sky replacement | Interior: HDR merge with window pull and a lit fireplace |

![Real estate HDR photo of a backyard patio with a fire pit, edited by the Stager AI API](https://cdn.stagerai.com/assets/vivid-1694007-8583822-ebb0a924.webp)
<p align="center"><em>Backyard: HDR merge, perspective correction and sky replacement</em></p>

## What's in this repo

| Folder | What it is |
| --- | --- |
| [`typescript/`](typescript) | Node.js / TypeScript SDK, published as [`stagerai` on npm](https://www.npmjs.com/package/stagerai) |
| [`python/`](python) | Python SDK, published as [`stagerai` on PyPI](https://pypi.org/project/stagerai/) |
| [`examples/`](examples) | Runnable scripts: curl, Node.js and Python |
| [`openapi.yaml`](openapi.yaml) | OpenAPI 3.1 spec. Import it into Postman, Insomnia or a code generator |

## Quickstart

### 1. Get an API key

API access is for business accounts and platforms. [Ask us in the chat](https://stagerai.com/api-docs) and we'll set up your key, then:

```bash
export STAGER_API_KEY=your_api_key
```

### 2. Install the SDK

```bash
npm install stagerai
```

```bash
pip install stagerai
```

### 3. Merge your first HDR bracket

**Node.js / TypeScript**

```ts
import { StagerAI } from "stagerai";

const stager = new StagerAI();

const project = await stager.projects.create("123 Main Street");
const hdr = await stager.hdr.processBracket({
  projectId: project.id,
  files: ["living_ev-2.CR3", "living_ev0.CR3", "living_ev+2.CR3"],
  lensCorrection: true,
  perspectiveCorrection: true,
});
console.log(hdr.imageUrl);
```

**Python**

```python
from stagerai import StagerAI

stager = StagerAI()

project = stager.projects.create("123 Main Street")
hdr = stager.hdr.process_bracket(
    project["id"],
    ["living_ev-2.CR3", "living_ev0.CR3", "living_ev+2.CR3"],
    lens_correction=True,
    perspective_correction=True,
)
print(hdr["imageUrl"])
```

**curl**: see [`examples/curl/hdr-bracket.sh`](examples/curl/hdr-bracket.sh).

## Edit a whole shoot in one call

Upload every photo of a listing and Stager AI finds the bracket groups from the EXIF data (capture time, exposure, ISO, aperture). This is best for high volume.

```ts
const batch = await stager.hdr.processBatch({
  projectId: project.id,
  files: shootPhotos, // any number of photos
  skyReplacement: true,
  lawnReplacement: true,
});

for (const r of batch.results) {
  console.log(r.filename, r.imageUrl ?? r.errorMessage);
}
```

Full script that downloads the results: [`examples/node/hdr-batch.mjs`](examples/node/hdr-batch.mjs) · [`examples/python/hdr_batch.py`](examples/python/hdr_batch.py)

## Virtual staging API

```ts
const image = await stager.images.upload("empty_living_room.jpg");

const { generationId } = await stager.edits.stage(image.id, {
  roomType: "LIVING_ROOM",
  roomStyle: "scandinavian", // modern, minimalist, japandi, luxury, farmhouse, coastalModern...
  colorTypes: ["classicWhite", "naturalWood"],
});

const staged = await stager.edits.wait(generationId);
console.log(staged.imageUrl);
```

The same pattern works for the other AI edits:

```ts
await stager.edits.renovate(imageId, { roomType: "KITCHEN", roomStyle: "modern" });
await stager.edits.skyReplace(imageId, { skyType: "twilight", skySubType: "dramatic" }); // day to dusk
await stager.edits.lawnReplace(imageId, { lawnType: "medium" });
await stager.edits.declutter(imageId);
```

Tip: the `groupId` of a finished HDR photo is also its `imageId`, so you can HDR-merge, then stage or twilight the result without uploading it again.

## Listing videos from photos

```ts
import { VideoEffect, CameraMotion } from "stagerai";

const video = await stager.videos.create({ orientation: "horizontal", title: "123 Main St tour" });
await stager.videos.addClip(video.id, {
  images: [{ id: livingRoomId, order: 0 }, { id: kitchenId, order: 1 }],
  effect: VideoEffect.SlowMotionWalkthrough,
  cameraMotion: CameraMotion.PushIn,
});
await stager.videos.render(video.id);
const { url } = await stager.videos.waitForRender(video.id);
```

Effects include slow-motion walkthroughs, aerial shots, split screen, before/after staging, day to night, summer to winter and before/after renovation.

## Webhooks instead of polling

Add a webhook URL on your account page under **API Access**. Stager AI signs every request, and the SDKs verify it:

```ts
import { constructWebhookEvent } from "stagerai";

const event = constructWebhookEvent(rawBody, req.headers, process.env.STAGER_WEBHOOK_SECRET);
// event.eventType: "hdr.image.completed" | "hdr.image.failed" | "edit.completed" | "edit.failed"
```

Examples: [Node.js (no framework)](examples/node/webhook-server.mjs) · [Python / Flask](examples/python/webhook_flask.py)

## Supported files

Canon (CR3, CR2), Nikon (NEF, NRW), Sony (ARW, SRF), Fujifilm (RAF), Panasonic (RW2), Adobe DNG, JPEG, PNG and TIFF.

## HDR error codes

| Code | Meaning |
| --- | --- |
| 1 | No credits left |
| 2 | Failed to merge the bracketed exposures |
| 3 | Failed to apply the requested edits |
| 4 | Failed to apply the editing style |
| 5 | Processing timed out |
| 6 | No images in the group |
| 7 | Could not convert the uploaded file (corrupted or unsupported) |
| 8 | Failed after the maximum number of retries |
| 9 | Failed to generate the enhanced image |
| 10 | More than 7 brackets in the group |
| 11 | Could not align the exposures (shot from different positions) |

## Who uses it

- **Real estate photographers** who want edited photos back minutes after the shoot, without outsourcing
- **Photo editing and media companies** that need consistent HDR output at volume
- **Brokerages, MLS tools, CRMs and proptech platforms** adding virtual staging or photo enhancement to their own product
- **Listing and marketing apps** generating property videos automatically

## FAQ

**How much does the API cost?**
$0.25 per final photo for HDR and AI edits, with an active subscription. Unused credits roll over. Videos cost 6 credits per scene. See [pricing](https://stagerai.com/api-docs#pricing).

**How long does processing take?**
An HDR bracket group usually takes 1 to 5 minutes. AI edits take under a minute. Video renders take 5 to 30 minutes.

**Can I match my own editing style?**
Yes. Choose between Stager Luma and Stager Classic V2, or [talk to us](https://stagerai.com/api-docs) about a custom style tuned to your look.

**Is there a free trial?**
You can [try Stager AI free](https://stagerai.com/register) in the web app, no credit card required.

## Links

- [API documentation](https://stagerai.com/api-docs)
- [Real estate photo editing API](https://stagerai.com/real-estate-ai-photo-editing-api)
- [Video from photos API](https://stagerai.com/real-estate-ai-video-from-photos-api)
- [Automated HDR editing for media companies](https://stagerai.com/automated-hdr-editing-for-real-estate-media-companies)
- [AI photo editing for real estate photographers](https://stagerai.com/real-estate-ai-photo-editing-for-photographers)
- [Virtual staging for photographers](https://stagerai.com/virtual-staging-for-real-estate-photographers)
- [Pricing](https://stagerai.com/pricing)

## Contributing

Issues and pull requests for the SDKs and examples are welcome. To run the tests:

```bash
cd typescript && npm install && npm test
```

```bash
cd python && pip install -e '.[dev]' && pytest
```

## License

The SDKs and examples are [MIT licensed](LICENSE). Using the Stager AI API is subject to the [Stager AI terms](https://stagerai.com/terms-and-conditions).
