"""Client for the Stager AI real estate photo editing API.

HDR bracket merging, virtual staging, virtual renovation, sky and lawn
replacement, decluttering and listing videos. Docs: https://stagerai.com/api-docs
"""

import os
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import (
    IO,
    Any,
    Callable,
    Dict,
    List,
    Optional,
    Sequence,
    Tuple,
    TypeVar,
    Union,
)

import requests

from .errors import StagerApiError, StagerProcessingError, StagerTimeoutError

DEFAULT_BASE_URL = "https://api.stagerai.com"

#: A file to upload: a path, raw bytes with a filename, or an open binary file.
FileInput = Union[str, os.PathLike, Tuple[str, bytes], IO[bytes]]

T = TypeVar("T")

# The MIME types the API binds signed upload URLs to. Raw formats (CR3, NEF,
# ARW...) have no binding, so they are uploaded without a Content-Type.
_SIGNED_MIME = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "tif": "image/tiff",
    "tiff": "image/tiff",
    "heic": "image/heic",
    "webp": "image/webp",
    "dng": "image/x-adobe-dng",
}

# Python names -> API field names for HDR options.
_HDR_FIELDS = {
    "lens_correction": "lensCorrection",
    "perspective_correction": "perspectiveCorrection",
    "photographer_removal": "photographerRemoval",
    "fireplace_enhancement": "fireplaceEnhancement",
    "tv_screen_replacement": "tvScreenReplacement",
    "auto_privacy": "autoPrivacy",
    "blur_license_plates": "blurLicensePlates",
    "sky_replacement": "skyReplacement",
    "lawn_replacement": "lawnReplacement",
    "editing_style": "editingStyle",
    "client_reference_id": "clientReferenceId",
}


class EditingStyle:
    LUMA = 15  #: Stager Luma (default)
    CLASSIC_V2 = 13  #: Stager Classic V2


class HdrErrorCode:
    NO_CREDITS = 1
    MERGE_FAILED = 2
    EDITS_FAILED = 3
    STYLE_FAILED = 4
    TIMEOUT = 5
    NO_IMAGES = 6
    CONVERSION_FAILED = 7
    MAX_RETRIES = 8
    GENERATION_FAILED = 9
    TOO_MANY_IMAGES = 10
    ALIGNMENT_FAILED = 11


class VideoEffect:
    DEFAULT = 0
    SLOW_MOTION_WALKTHROUGH = 1
    SLOW_MOTION_AERIAL = 2
    FAST_SPEED_RAMPS = 3
    SPLIT_SCREEN = 4
    EXTERIOR_TO_INTERIOR = 5
    STAGING_FURNITURE_APPEARS = 6
    DAWN_TO_NOON = 7
    DAY_TO_NIGHT = 8
    STARRY_NIGHT = 9
    SUMMER_TO_WINTER = 10
    HOUSE_LANDS_ON_TERRAIN = 11
    HOUSE_BUILDS_UP = 12
    RENOVATION = 13


class CameraMotion:
    """Only used with VideoEffect.SLOW_MOTION_WALKTHROUGH."""

    DEFAULT = 0
    PUSH_IN = 1
    PUSH_OUT = 2
    SLOW_MO_DESCENDING = 3
    SLOW_MO_ELEVATING = 4
    ORBIT_RIGHT = 5
    ORBIT_LEFT = 6


def content_type_for(filename: str) -> Optional[str]:
    """The Content-Type a signed upload URL expects for this filename, if any."""
    return _SIGNED_MIME.get(filename.rsplit(".", 1)[-1].lower())


def _read_file(file: FileInput) -> Tuple[str, bytes]:
    if isinstance(file, (str, os.PathLike)):
        path = Path(file)
        return path.name, path.read_bytes()
    if isinstance(file, tuple):
        filename, data = file
        return filename, data
    name = getattr(file, "name", None)
    if not name:
        raise TypeError("A file object needs a name: pass (filename, bytes) instead")
    return os.path.basename(str(name)), file.read()


def _hdr_body(options: Dict[str, Any]) -> Dict[str, Any]:
    body = {}
    for key, value in options.items():
        if key not in _HDR_FIELDS:
            raise TypeError(f"Unknown HDR option: {key}")
        if value is not None:
            body[_HDR_FIELDS[key]] = value
    return body


def _clean(d: Dict[str, Any]) -> Dict[str, Any]:
    return {k: v for k, v in d.items() if v is not None}


def _unwrap(body: Any) -> Any:
    """Removes the {"status": "success", "data": ...} envelope."""
    if isinstance(body, dict) and "data" in body and set(body) <= {"data", "status", "success"}:
        return body["data"]
    return body


class StagerAI:
    """Stager AI API client.

    Example::

        from stagerai import StagerAI

        stager = StagerAI()  # reads STAGER_API_KEY
        project = stager.projects.create("123 Main St")
        hdr = stager.hdr.process_bracket(
            project["id"], ["ev-2.jpg", "ev0.jpg", "ev+2.jpg"]
        )
        print(hdr["imageUrl"])
    """

    def __init__(
        self,
        api_key: Optional[str] = None,
        base_url: str = DEFAULT_BASE_URL,
        timeout: float = 60.0,
        max_retries: int = 2,
        session: Optional[requests.Session] = None,
    ):
        api_key = api_key or os.environ.get("STAGER_API_KEY")
        if not api_key:
            raise ValueError("Missing API key: pass api_key or set STAGER_API_KEY")
        self.api_key = api_key
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.max_retries = max_retries
        self.session = session or requests.Session()

        self.projects = Projects(self)
        self.hdr = Hdr(self)
        self.tv_screens = TvScreens(self)
        self.images = Images(self)
        self.edits = Edits(self)
        self.videos = Videos(self)

    def get_photos_quota(self) -> Dict[str, Any]:
        """Photo credits left on your account: ``{"photosQuota": 128}``."""
        return self.request("GET", "/api/photos-quota")

    def request(
        self,
        method: str,
        path: str,
        json: Any = None,
        params: Optional[Dict[str, Any]] = None,
        files: Any = None,
    ) -> Any:
        """Low-level request. Paths start with /api/. Unwraps the response envelope."""
        headers = {"stager-api-key": self.api_key, "accept": "application/json"}
        retries = self.max_retries if method == "GET" else 0
        attempt = 0
        while True:
            try:
                res = self.session.request(
                    method,
                    self.base_url + path,
                    headers=headers,
                    json=json,
                    params=_clean(params or {}),
                    files=files,
                    timeout=self.timeout,
                )
            except requests.RequestException:
                if attempt < retries:
                    time.sleep(0.5 * 2**attempt)
                    attempt += 1
                    continue
                raise
            if (res.status_code >= 500 or res.status_code == 429) and attempt < retries:
                time.sleep(0.5 * 2**attempt)
                attempt += 1
                continue
            try:
                body = res.json() if res.content else {}
            except ValueError:
                body = res.text
            if not res.ok:
                message = body.get("message") if isinstance(body, dict) else None
                if isinstance(message, list):
                    message = ", ".join(map(str, message))
                code_key = body.get("codeKey") if isinstance(body, dict) else None
                raise StagerApiError(message or f"HTTP {res.status_code}", res.status_code, body, code_key)
            return _unwrap(body)

    def upload_to_signed_url(self, upload_url: str, file: FileInput, filename: Optional[str] = None) -> None:
        """PUTs a file to a signed upload URL returned by the HDR endpoints."""
        name, data = _read_file(file)
        content_type = content_type_for(filename or name)
        headers = {"content-type": content_type} if content_type else {}
        res = self.session.put(upload_url, data=data, headers=headers, timeout=max(self.timeout, 300))
        if not res.ok:
            raise StagerApiError(f"Upload failed: HTTP {res.status_code}", res.status_code, res.text)

    def _multipart(self, path: str, file: FileInput) -> Any:
        name, data = _read_file(file)
        return self.request("POST", path, files={"file": (name, data)})

    def _poll(
        self,
        fetch: Callable[[], T],
        is_done: Callable[[T], bool],
        what: str,
        interval: float,
        timeout: float,
        on_poll: Optional[Callable[[T], None]] = None,
    ) -> T:
        deadline = time.monotonic() + timeout
        while True:
            status = fetch()
            if on_poll:
                on_poll(status)
            if is_done(status):
                return status
            if time.monotonic() + interval > deadline:
                raise StagerTimeoutError(f"Timed out waiting for {what}")
            time.sleep(interval)


class Projects:
    def __init__(self, client: StagerAI):
        self._c = client

    def create(self, title: str) -> Dict[str, Any]:
        """Creates a project: a folder for one listing. Returns ``{"id", "title"}``."""
        return self._c.request("POST", "/api/projects", json={"title": title})


class Hdr:
    """HDR bracket merging, lens and perspective correction, window pulls.

    HDR options (all optional, as keyword arguments): ``lens_correction``,
    ``perspective_correction``, ``photographer_removal``, ``fireplace_enhancement``,
    ``tv_screen_replacement``, ``auto_privacy``, ``blur_license_plates``,
    ``sky_replacement`` (on by default), ``lawn_replacement`` (off by default),
    ``editing_style`` (EditingStyle.LUMA or EditingStyle.CLASSIC_V2) and
    ``client_reference_id``.
    """

    def __init__(self, client: StagerAI):
        self._c = client

    # ---- Option 2: single bracket group ----

    def create_group(self, project_id: str, **options: Any) -> Dict[str, Any]:
        """Creates an HDR group for one bracket set (up to 7 exposures)."""
        return self._c.request("POST", "/api/hdr-image-group", json={"projectId": project_id, **_hdr_body(options)})

    def get_group_upload_url(self, group_id: str, filename: str) -> Dict[str, Any]:
        """Returns ``{"id", "uploadUrl"}`` to PUT one exposure to."""
        return self._c.request("POST", "/api/hdr-upload-url", json={"groupId": group_id, "filename": filename})

    def upload_to_group(self, group_id: str, file: FileInput) -> str:
        """Uploads one exposure to the group. Returns the raw image id."""
        name, data = _read_file(file)
        res = self.get_group_upload_url(group_id, name)
        self._c.upload_to_signed_url(res["uploadUrl"], (name, data))
        return res["id"]

    def enhance_group(self, group_id: str, tv_logo_id: Optional[str] = None) -> Dict[str, Any]:
        """Starts merging the uploaded exposures."""
        return self._c.request("POST", "/api/hdr-enhance", json=_clean({"groupId": group_id, "tvLogoId": tv_logo_id}))

    def get_group(self, group_id: str, format: Optional[str] = None) -> Dict[str, Any]:
        """Status of a group: ``processing``, ``completed`` (with ``imageUrl``) or ``error``."""
        return self._c.request("GET", f"/api/hdr-image-group/{group_id}", params={"format": format})

    def wait_for_group(
        self,
        group_id: str,
        format: Optional[str] = None,
        interval: float = 7,
        timeout: float = 30 * 60,
        on_poll: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """Polls until the group is done. Raises StagerProcessingError on error."""
        status = self._c._poll(
            lambda: self.get_group(group_id, format),
            lambda s: s.get("status") != "processing",
            f"HDR group {group_id}",
            interval,
            timeout,
            on_poll,
        )
        if status.get("status") == "error":
            raise StagerProcessingError(
                status.get("errorMessage") or status.get("message") or "HDR processing failed",
                status,
                status.get("code"),
            )
        return {**status, "groupId": group_id}

    def process_bracket(
        self,
        project_id: str,
        files: Sequence[FileInput],
        tv_logo_id: Optional[str] = None,
        format: Optional[str] = None,
        interval: float = 7,
        timeout: float = 30 * 60,
        **options: Any,
    ) -> Dict[str, Any]:
        """One call for a bracket set: create, upload, process and wait.

        The returned ``groupId`` is also the ``imageId`` for AI edits.
        """
        if not 1 <= len(files) <= 7:
            raise ValueError("A bracket group needs 1 to 7 exposures")
        group_id = self.create_group(project_id, **options)["groupId"]
        for file in files:
            self.upload_to_group(group_id, file)
        self.enhance_group(group_id, tv_logo_id)
        return self.wait_for_group(group_id, format, interval, timeout)

    # ---- Option 1: batch with automatic bracket grouping ----

    def create_batch(self, project_id: str, **options: Any) -> Dict[str, Any]:
        """Opens a batch for every photo of one listing. Returns ``{"batchId"}``."""
        return self._c.request("POST", "/api/hdr-batch", json={"projectId": project_id, **_hdr_body(options)})

    def get_batch_upload_url(self, batch_id: str, filename: str) -> Dict[str, Any]:
        """Returns ``{"id", "url"}`` to PUT one photo to."""
        return self._c.request("POST", f"/api/hdr-batch/{batch_id}/url", json={"filename": filename})

    def upload_to_batch(self, batch_id: str, file: FileInput) -> str:
        name, data = _read_file(file)
        res = self.get_batch_upload_url(batch_id, name)
        self._c.upload_to_signed_url(res["url"], (name, data))
        return res["id"]

    def enhance_batch(self, batch_id: str) -> Dict[str, Any]:
        """Groups the uploaded photos into brackets and starts processing."""
        return self._c.request("POST", f"/api/hdr-batch/{batch_id}/enhance")

    def get_batch(self, batch_id: str, format: Optional[str] = None) -> Dict[str, Any]:
        return self._c.request("GET", f"/api/hdr-batch/{batch_id}", params={"format": format})

    def wait_for_batch(
        self,
        batch_id: str,
        format: Optional[str] = None,
        interval: float = 30,
        timeout: float = 120 * 60,
        on_poll: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """Polls until every bracket group has a photo or an error.

        Failed groups stay in ``results`` with ``status == "error"``; check them.
        """

        def done(s: Dict[str, Any]) -> bool:
            if s.get("status") == "error":
                return True
            results = s.get("results") or []
            return (
                not s.get("processing")
                and len(results) > 0
                and all(r.get("imageUrl") or r.get("status") == "error" for r in results)
            )

        status = self._c._poll(
            lambda: self.get_batch(batch_id, format), done, f"HDR batch {batch_id}", interval, timeout, on_poll
        )
        if status.get("status") == "error":
            raise StagerProcessingError(status.get("message") or "HDR batch failed", status)
        return status

    def process_batch(
        self,
        project_id: str,
        files: Sequence[FileInput],
        concurrency: int = 4,
        format: Optional[str] = None,
        interval: float = 30,
        timeout: float = 120 * 60,
        **options: Any,
    ) -> Dict[str, Any]:
        """One call for a whole listing: upload every photo, let Stager AI find
        the bracket groups from EXIF data, and wait for all the results."""
        batch_id = self.create_batch(project_id, **options)["batchId"]
        with ThreadPoolExecutor(max_workers=concurrency) as pool:
            list(pool.map(lambda f: self.upload_to_batch(batch_id, f), files))
        self.enhance_batch(batch_id)
        return {**self.wait_for_batch(batch_id, format, interval, timeout), "batchId": batch_id}


class TvScreens:
    def __init__(self, client: StagerAI):
        self._c = client

    def upload(self, file: FileInput) -> Dict[str, Any]:
        """Uploads an image or logo to show on TVs (JPEG, PNG, WebP or HEIC, up to 25 MB)."""
        return self._c._multipart("/api/tv-screen-images", file)

    def list(self, offset: int = 0, limit: int = 50) -> Dict[str, Any]:
        return self._c.request("GET", "/api/tv-screen-images", params={"offset": offset, "limit": limit})


class Images:
    def __init__(self, client: StagerAI):
        self._c = client

    def upload(self, file: FileInput) -> Dict[str, Any]:
        """Uploads a photo for AI edits or videos. The returned ``id`` is the imageId."""
        return self._c._multipart("/api/image", file)


class Edits:
    """Virtual staging, renovation, lawn and sky replacement, declutter."""

    def __init__(self, client: StagerAI):
        self._c = client

    def _start(self, image_id: str, action: str, body: Dict[str, Any]) -> Dict[str, Any]:
        return self._c.request("POST", f"/api/images/{image_id}/{action}", json=_clean(body))

    def stage(
        self,
        image_id: str,
        room_type: str,
        room_style: str,
        action_type: Optional[str] = None,
        color_types: Optional[List[str]] = None,
        remove_furniture: Optional[bool] = None,
        extra_instructions: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Virtual staging. ``action_type`` is "subtleStaging" or "autoStaging"."""
        return self._start(
            image_id,
            "stage",
            {
                "roomType": room_type,
                "roomStyle": room_style,
                "actionType": action_type,
                "colorTypes": color_types,
                "removeFurniture": remove_furniture,
                "extraInstructions": extra_instructions,
            },
        )

    def renovate(
        self,
        image_id: str,
        room_type: str,
        room_style: Optional[str] = None,
        color_types: Optional[List[str]] = None,
        extra_instructions: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Virtual renovation: new finishes, fixtures and furniture."""
        return self._start(
            image_id,
            "renovate",
            {
                "roomType": room_type,
                "roomStyle": room_style,
                "colorTypes": color_types,
                "extraInstructions": extra_instructions,
            },
        )

    def lawn_replace(
        self, image_id: str, lawn_type: Optional[str] = None, extra_instructions: Optional[str] = None
    ) -> Dict[str, Any]:
        """Fresh lawn. ``lawn_type`` is "light", "medium" or "strong"."""
        return self._start(image_id, "lawn-replace", {"lawnType": lawn_type, "extraInstructions": extra_instructions})

    def sky_replace(self, image_id: str, sky_type: str, sky_sub_type: Optional[str] = None) -> Dict[str, Any]:
        """``sky_type`` "blue" or "twilight"; ``sky_sub_type`` "subtle", "middle" or "dramatic"."""
        return self._start(image_id, "sky-replace", {"skyType": sky_type, "skySubType": sky_sub_type})

    def declutter(self, image_id: str, extra_instructions: Optional[str] = None) -> Dict[str, Any]:
        """Removes furniture and objects, leaving the room empty."""
        return self._start(image_id, "declutter", {"extraInstructions": extra_instructions})

    def get(self, generation_id: str) -> Dict[str, Any]:
        return self._c.request("GET", f"/api/generations/{generation_id}")

    def wait(
        self,
        generation_id: str,
        interval: float = 5,
        timeout: float = 15 * 60,
        on_poll: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """Polls until the edit is done. Raises StagerProcessingError if it failed."""
        g = self._c._poll(
            lambda: self.get(generation_id),
            lambda s: s.get("status") != "processing",
            f"edit {generation_id}",
            interval,
            timeout,
            on_poll,
        )
        if g.get("status") == "failed":
            raise StagerProcessingError("AI edit failed", g)
        return g


class Videos:
    """Listing videos from photos."""

    def __init__(self, client: StagerAI):
        self._c = client

    def list_audio(self) -> List[Dict[str, Any]]:
        return self._c.request("GET", "/api/audio")["items"]

    def create(self, orientation: str = "horizontal", title: Optional[str] = None, audio_id: Optional[str] = None) -> Dict[str, Any]:
        return self._c.request(
            "POST", "/api/videos", json=_clean({"title": title, "orientation": orientation, "audioId": audio_id})
        )

    def list(self, offset: int = 0, limit: int = 50) -> Dict[str, Any]:
        return self._c.request("GET", "/api/videos", params={"offset": offset, "limit": limit})

    def get(self, video_id: str) -> Dict[str, Any]:
        return self._c.request("GET", f"/api/videos/{video_id}")

    def add_clip(
        self,
        video_id: str,
        image_ids: Sequence[str],
        effect: Optional[int] = None,
        camera_motion: Optional[int] = None,
        custom_instructions: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Adds a scene of 1 to 5 photos, in the given order."""
        images = [{"id": image_id, "order": i} for i, image_id in enumerate(image_ids)]
        return self._c.request(
            "POST",
            f"/api/videos/{video_id}/clips",
            json=_clean(
                {
                    "images": images,
                    "effect": effect,
                    "cameraMotion": camera_motion,
                    "customInstructions": custom_instructions,
                }
            ),
        )

    def update_clip(
        self,
        video_id: str,
        clip_id: str,
        image_ids: Optional[Sequence[str]] = None,
        effect: Optional[int] = None,
        camera_motion: Optional[int] = None,
        custom_instructions: Optional[str] = None,
    ) -> Dict[str, Any]:
        images = [{"id": image_id, "order": i} for i, image_id in enumerate(image_ids)] if image_ids else None
        return self._c.request(
            "PUT",
            f"/api/videos/{video_id}/clips/{clip_id}",
            json=_clean(
                {
                    "images": images,
                    "effect": effect,
                    "cameraMotion": camera_motion,
                    "customInstructions": custom_instructions,
                }
            ),
        )

    def delete_clip(self, video_id: str, clip_id: str) -> Dict[str, Any]:
        return self._c.request("DELETE", f"/api/videos/{video_id}/clips/{clip_id}")

    def render(self, video_id: str) -> Dict[str, Any]:
        return self._c.request("POST", f"/api/videos/{video_id}/render", json={})

    def progress(self, video_id: str) -> Dict[str, Any]:
        return self._c.request("GET", f"/api/videos/{video_id}/progress")

    def wait_for_render(
        self,
        video_id: str,
        interval: float = 10,
        timeout: float = 60 * 60,
        on_poll: Optional[Callable[[Dict[str, Any]], None]] = None,
    ) -> Dict[str, Any]:
        """Polls until the render is done. Returns ``{"status": "done", "url", "size"}``."""
        p = self._c._poll(
            lambda: self.progress(video_id),
            lambda s: s.get("status") != "progress",
            f"video render {video_id}",
            interval,
            timeout,
            on_poll,
        )
        if p.get("status") == "error":
            raise StagerProcessingError(p.get("message") or "Render failed", p)
        return p
