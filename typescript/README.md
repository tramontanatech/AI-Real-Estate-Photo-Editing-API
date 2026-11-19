# stagerai: Node.js / TypeScript SDK for the Stager AI Real Estate Photo Editing API

[![npm](https://img.shields.io/npm/v/stagerai.svg)](https://www.npmjs.com/package/stagerai)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/tramontanatech/AI-Real-Estate-Photo-Editing-API/blob/main/LICENSE)

Official TypeScript client for the [Stager AI API](https://stagerai.com/api-docs). Automate **HDR bracket merging**, **lens and perspective correction**, **window pulls**, **virtual staging**, **virtual renovation**, **sky replacement (day to dusk)**, **lawn replacement**, **decluttering** and **listing videos** for real estate photos.

Zero dependencies, fully typed, ESM and CommonJS, Node 18+.

![HDR real estate photo edited with the Stager AI API: living room with a stone fireplace](https://cdn.stagerai.com/assets/real-estate-living-room-stone-fireplace-697ee0c0.webp)

## Install

```bash
npm install stagerai
```

Get an API key from [stagerai.com/api-docs](https://stagerai.com/api-docs) and set it as `STAGER_API_KEY`.

## Merge HDR brackets

```ts
import { StagerAI } from "stagerai";

const stager = new StagerAI(); // reads STAGER_API_KEY

const project = await stager.projects.create("123 Main Street");
const hdr = await stager.hdr.processBracket({
  projectId: project.id,
  files: ["living_ev-2.CR3", "living_ev0.CR3", "living_ev+2.CR3"],
  lensCorrection: true,
  perspectiveCorrection: true,
  skyReplacement: true,
});
console.log(hdr.imageUrl);
```

## Edit a whole listing at once (automatic bracket grouping)

```ts
const batch = await stager.hdr.processBatch({
  projectId: project.id,
  files: ["shoot/IMG_0001.jpg", "shoot/IMG_0002.jpg" /* ... */],
  lawnReplacement: true,
});
for (const r of batch.results) console.log(r.filename, r.imageUrl ?? r.errorMessage);
```

## Virtual staging, renovation, sky and lawn replacement

```ts
const image = await stager.images.upload("empty_living_room.jpg");

const { generationId } = await stager.edits.stage(image.id, {
  roomType: "LIVING_ROOM",
  roomStyle: "scandinavian",
  colorTypes: ["classicWhite", "naturalWood"],
});
const staged = await stager.edits.wait(generationId);
console.log(staged.imageUrl);

await stager.edits.skyReplace(image.id, { skyType: "twilight", skySubType: "dramatic" });
await stager.edits.lawnReplace(image.id, { lawnType: "medium" });
await stager.edits.renovate(image.id, { roomType: "KITCHEN", roomStyle: "modern" });
await stager.edits.declutter(image.id);
```

The `groupId` of a finished HDR photo is also its `imageId`, so you can stage or twilight an HDR result without uploading it again.

## Listing videos

```ts
import { VideoEffect } from "stagerai";

const video = await stager.videos.create({ orientation: "horizontal", title: "123 Main St tour" });
await stager.videos.addClip(video.id, {
  images: [{ id: image.id, order: 0 }],
  effect: VideoEffect.SlowMotionWalkthrough,
});
await stager.videos.render(video.id);
const { url } = await stager.videos.waitForRender(video.id);
```

## Webhooks

```ts
import { constructWebhookEvent } from "stagerai";

// Express: use express.raw({ type: "application/json" }) so the body is not re-serialized
app.post("/webhooks/stager", express.raw({ type: "application/json" }), (req, res) => {
  const event = constructWebhookEvent(req.body, req.headers, process.env.STAGER_WEBHOOK_SECRET!);
  if (event.eventType === "hdr.image.completed") console.log(event.data.imageUrl);
  res.sendStatus(200);
});
```

## Errors

| Error | When |
| --- | --- |
| `StagerApiError` | The API answered with a 4xx or 5xx (`.status`, `.body`) |
| `StagerProcessingError` | An HDR group, edit or render failed (`.code` is the HDR error code) |
| `StagerTimeoutError` | A `wait*` helper ran out of time |

Full docs, pricing and every endpoint: **[stagerai.com/api-docs](https://stagerai.com/api-docs)**. More examples: [GitHub](https://github.com/tramontanatech/AI-Real-Estate-Photo-Editing-API).
