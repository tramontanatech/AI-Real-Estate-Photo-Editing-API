"""Virtually stage an empty room with the Stager AI API.

    pip install stagerai
    STAGER_API_KEY=your_api_key python virtual_staging.py empty_room.jpg
"""

import sys

from stagerai import StagerAI

photo = sys.argv[1] if len(sys.argv) > 1 else "empty_room.jpg"
stager = StagerAI()

image = stager.images.upload(photo)
print(f"Uploaded {image['id']} ({image['width']}x{image['height']})")

gen = stager.edits.stage(
    image["id"],
    room_type="BEDROOM",
    room_style="japandi",
    action_type="subtleStaging",
    color_types=["beige", "naturalWood"],
)
result = stager.edits.wait(gen["generationId"])
print(f"Staged: {result['imageUrl']}")

# Other edits work the same way:
#   stager.edits.renovate(image["id"], room_type="KITCHEN", room_style="modern")
#   stager.edits.sky_replace(image["id"], sky_type="twilight", sky_sub_type="dramatic")
#   stager.edits.lawn_replace(image["id"], lawn_type="medium")
#   stager.edits.declutter(image["id"])
