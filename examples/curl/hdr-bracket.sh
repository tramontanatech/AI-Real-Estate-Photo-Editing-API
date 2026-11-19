#!/usr/bin/env bash
# Merge one set of bracketed exposures into an HDR real estate photo with curl.
#
#   export STAGER_API_KEY=your_api_key
#   ./hdr-bracket.sh ev-2.jpg ev0.jpg ev+2.jpg
#
# Needs curl and jq.
set -euo pipefail

API="https://api.stagerai.com"
KEY_HEADER="stager-api-key: ${STAGER_API_KEY:?Set STAGER_API_KEY}"

if [ "$#" -lt 1 ] || [ "$#" -gt 7 ]; then
  echo "Usage: $0 exposure1.jpg [exposure2.jpg ... exposure7.jpg]" >&2
  exit 1
fi

# 1. Create a project (one per listing)
PROJECT_ID=$(curl -sf -X POST "$API/api/projects" -H "$KEY_HEADER" \
  -H "content-type: application/json" -d '{"title":"curl example"}' | jq -r '.data.id // .id')
echo "Project: $PROJECT_ID"

# 2. Create an HDR group with the edits to apply
GROUP_ID=$(curl -sf -X POST "$API/api/hdr-image-group" -H "$KEY_HEADER" \
  -H "content-type: application/json" \
  -d "{\"projectId\":\"$PROJECT_ID\",\"lensCorrection\":true,\"perspectiveCorrection\":true,\"skyReplacement\":true}" \
  | jq -r '.data.groupId // .groupId')
echo "Group: $GROUP_ID"

# 3. Upload every exposure to its own signed URL
for FILE in "$@"; do
  NAME=$(basename "$FILE")
  UPLOAD_URL=$(curl -sf -X POST "$API/api/hdr-upload-url" -H "$KEY_HEADER" \
    -H "content-type: application/json" \
    -d "{\"groupId\":\"$GROUP_ID\",\"filename\":\"$NAME\"}" | jq -r '.data.uploadUrl // .uploadUrl')

  # The signed URL is bound to the file's MIME type (JPEG/PNG/TIFF...). Raw files go without one.
  case "${NAME##*.}" in
    jpg|JPG|jpeg|JPEG) TYPE=(-H "content-type: image/jpeg") ;;
    png|PNG) TYPE=(-H "content-type: image/png") ;;
    tif|TIF|tiff|TIFF) TYPE=(-H "content-type: image/tiff") ;;
    *) TYPE=() ;;
  esac
  curl -sf -X PUT "$UPLOAD_URL" "${TYPE[@]}" --data-binary "@$FILE" > /dev/null
  echo "Uploaded $NAME"
done

# 4. Start processing
curl -sf -X POST "$API/api/hdr-enhance" -H "$KEY_HEADER" \
  -H "content-type: application/json" -d "{\"groupId\":\"$GROUP_ID\"}" > /dev/null

# 5. Poll until the HDR photo is ready
while true; do
  RESULT=$(curl -sf "$API/api/hdr-image-group/$GROUP_ID?format=jpg" -H "$KEY_HEADER" | jq '.data // .')
  STATUS=$(echo "$RESULT" | jq -r '.status')
  case "$STATUS" in
    completed) echo "Done: $(echo "$RESULT" | jq -r '.imageUrl')"; break ;;
    error) echo "Failed: $(echo "$RESULT" | jq -r '.errorMessage')" >&2; exit 1 ;;
    *) echo "Processing..."; sleep 10 ;;
  esac
done
