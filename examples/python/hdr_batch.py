"""Edit a whole real estate shoot: upload every bracket, let Stager AI group
them by EXIF data, and download the finished HDR photos.

    pip install stagerai
    STAGER_API_KEY=your_api_key python hdr_batch.py ./shoot ./edited
"""

import sys
from pathlib import Path

import requests

from stagerai import StagerAI

PHOTO_EXTS = {".jpg", ".jpeg", ".png", ".tif", ".tiff", ".dng", ".cr2", ".cr3",
              ".nef", ".nrw", ".arw", ".srf", ".raf", ".rw2"}

input_dir = Path(sys.argv[1] if len(sys.argv) > 1 else "shoot")
output_dir = Path(sys.argv[2] if len(sys.argv) > 2 else "edited")

stager = StagerAI()

files = sorted(p for p in input_dir.iterdir() if p.suffix.lower() in PHOTO_EXTS)
print(f"Found {len(files)} photos, {stager.get_photos_quota()['photosQuota']} credits left")

project = stager.projects.create(input_dir.name)
batch = stager.hdr.process_batch(
    project["id"],
    files,
    lens_correction=True,
    perspective_correction=True,
    sky_replacement=True,
)

output_dir.mkdir(parents=True, exist_ok=True)
for r in batch["results"]:
    if r.get("status") == "error":
        print(f"✗ {r['filename']}: {r.get('errorMessage')}")
        continue
    out = output_dir / f"{Path(r['filename']).stem}_hdr.jpg"
    out.write_bytes(requests.get(r["imageUrl"], timeout=120).content)
    print(f"✓ {out}")
