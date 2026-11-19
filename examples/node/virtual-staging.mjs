// Virtually stage an empty room, then turn the exterior into a twilight shot.
//
//   npm install stagerai
//   STAGER_API_KEY=your_api_key node virtual-staging.mjs empty_room.jpg

import { StagerAI } from "stagerai";

const [photo = "empty_room.jpg"] = process.argv.slice(2);
const stager = new StagerAI();

const image = await stager.images.upload(photo);
console.log(`Uploaded ${image.id} (${image.width}x${image.height})`);

const { generationId } = await stager.edits.stage(image.id, {
  roomType: "LIVING_ROOM",
  roomStyle: "scandinavian",
  actionType: "subtleStaging",
  colorTypes: ["classicWhite", "naturalWood"],
  extraInstructions: "Add a linen sofa and a round coffee table",
});

const staged = await stager.edits.wait(generationId);
console.log(`Staged: ${staged.imageUrl}`);

// Other edits work the same way:
//   stager.edits.renovate(image.id, { roomType: "KITCHEN", roomStyle: "modern" })
//   stager.edits.skyReplace(image.id, { skyType: "twilight", skySubType: "dramatic" })
//   stager.edits.lawnReplace(image.id, { lawnType: "medium" })
//   stager.edits.declutter(image.id)
