// Edit a whole real estate shoot: upload every bracket, let Stager AI group
// them by EXIF data, and download the finished HDR photos.
//
//   npm install stagerai
//   STAGER_API_KEY=your_api_key node hdr-batch.mjs ./shoot ./edited

import { readdir, writeFile, mkdir } from "node:fs/promises";
import { join, extname, basename } from "node:path";
import { StagerAI } from "stagerai";

const [inputDir = "./shoot", outputDir = "./edited"] = process.argv.slice(2);
const PHOTO = /\.(jpe?g|png|tiff?|dng|cr2|cr3|nef|nrw|arw|srf|raf|rw2)$/i;

const stager = new StagerAI();

const files = (await readdir(inputDir)).filter((f) => PHOTO.test(f)).map((f) => join(inputDir, f));
console.log(`Found ${files.length} photos`);

const { photosQuota } = await stager.getPhotosQuota();
console.log(`Credits left: ${photosQuota}`);

const project = await stager.projects.create(basename(inputDir));
const batch = await stager.hdr.processBatch({
  projectId: project.id,
  files,
  lensCorrection: true,
  perspectiveCorrection: true,
  skyReplacement: true,
  onUpload: (name, i) => console.log(`Uploaded ${i + 1}/${files.length} ${name}`),
  wait: {
    onPoll: (s) => {
      const done = s.results.filter((r) => r.imageUrl || r.status === "error").length;
      console.log(`Processing: ${done}/${s.results.length} bracket groups ready`);
    },
  },
});

await mkdir(outputDir, { recursive: true });
for (const r of batch.results) {
  if (r.status === "error") {
    console.error(`✗ ${r.filename}: ${r.errorMessage}`);
    continue;
  }
  const out = join(outputDir, basename(r.filename, extname(r.filename)) + "_hdr.jpg");
  const res = await fetch(r.imageUrl);
  await writeFile(out, Buffer.from(await res.arrayBuffer()));
  console.log(`✓ ${out}`);
}
