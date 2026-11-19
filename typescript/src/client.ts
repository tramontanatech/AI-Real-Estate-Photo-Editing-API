import { StagerApiError, StagerProcessingError, StagerTimeoutError } from "./errors.js";
import type {
  AudioTrack,
  ClipParams,
  CreateVideoParams,
  DeclutterParams,
  Generation,
  HdrBatchStatus,
  HdrGroupStatus,
  HdrOptions,
  LawnReplaceParams,
  Paginated,
  PhotosQuota,
  Project,
  RenderProgress,
  RenovateParams,
  SkyReplaceParams,
  StageParams,
  TvScreenImage,
  UploadedImage,
  UploadUrl,
  Video,
} from "./types.js";

export const DEFAULT_BASE_URL = "https://api.stagerai.com";

export interface StagerAIOptions {
  /** Your API key. Defaults to the STAGER_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to https://api.stagerai.com */
  baseUrl?: string;
  /** Per-request timeout in ms. Default 60 s. */
  timeoutMs?: number;
  /** Retries for GET requests on network errors and 5xx/429. Default 2. */
  maxRetries?: number;
  /** Custom fetch implementation. Defaults to the global fetch (Node 18+). */
  fetch?: typeof fetch;
}

/**
 * A file to upload: a local path (Node only), a File/Blob with a name,
 * or raw bytes with a filename.
 */
export type FileInput =
  | string
  | File
  | { data: Uint8Array | ArrayBuffer | Blob; filename: string };

export interface WaitOptions {
  /** How often to poll, in ms. */
  intervalMs?: number;
  /** Give up after this many ms. */
  timeoutMs?: number;
  /** Called after every poll, handy for progress logs. */
  onPoll?: (status: unknown) => void;
  signal?: AbortSignal;
}

export type ImageFormat = "jpg" | "png";

// The MIME types the API binds signed upload URLs to (mime-types lookup).
// Raw formats have no binding, so they are sent without a Content-Type.
const SIGNED_MIME: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  tif: "image/tiff",
  tiff: "image/tiff",
  heic: "image/heic",
  webp: "image/webp",
  dng: "image/x-adobe-dng",
};

/** The Content-Type a signed upload URL expects for this filename, if any. */
export function contentTypeFor(filename: string): string | undefined {
  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  return SIGNED_MIME[ext];
}

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const t = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true }
    );
  });

async function resolveFile(file: FileInput): Promise<{ blob: Blob; filename: string }> {
  if (typeof file === "string") {
    const { readFile } = await import("node:fs/promises");
    const { basename } = await import("node:path");
    const bytes = await readFile(file);
    return { blob: new Blob([bytes]), filename: basename(file) };
  }
  if (typeof Blob !== "undefined" && file instanceof Blob) {
    const name = (file as File).name;
    if (!name) throw new TypeError("A Blob upload needs a filename: pass { data, filename }");
    return { blob: file, filename: name };
  }
  const { data, filename } = file as { data: Uint8Array | ArrayBuffer | Blob; filename: string };
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart]);
  return { blob, filename };
}

/** Removes the { status: "success", data } / { success: true, data } envelope. */
function unwrap<T>(body: unknown): T {
  if (body && typeof body === "object" && "data" in body) {
    const keys = Object.keys(body);
    if (keys.every((k) => k === "data" || k === "status" || k === "success")) {
      return (body as { data: T }).data;
    }
  }
  return body as T;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T, i: number) => Promise<R>) {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]!, i);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Client for the Stager AI real estate photo editing API:
 * HDR bracket merging, virtual staging, renovation, sky and lawn replacement,
 * decluttering and listing videos.
 *
 * @example
 * const stager = new StagerAI({ apiKey: process.env.STAGER_API_KEY });
 * const project = await stager.projects.create("123 Main St");
 * const hdr = await stager.hdr.processBracket({
 *   projectId: project.id,
 *   files: ["./ev-2.jpg", "./ev0.jpg", "./ev+2.jpg"],
 * });
 * console.log(hdr.imageUrl);
 */
export class StagerAI {
  readonly baseUrl: string;
  private readonly apiKey: string;
  private readonly timeoutMs: number;
  private readonly maxRetries: number;
  private readonly fetchImpl: typeof fetch;

  readonly projects: Projects;
  readonly hdr: Hdr;
  readonly tvScreens: TvScreens;
  readonly images: Images;
  readonly edits: Edits;
  readonly videos: Videos;

  constructor(options: StagerAIOptions = {}) {
    const apiKey =
      options.apiKey ??
      (typeof process !== "undefined" ? process.env?.STAGER_API_KEY : undefined);
    if (!apiKey) {
      throw new Error("Missing API key: pass { apiKey } or set STAGER_API_KEY");
    }
    this.apiKey = apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
    this.timeoutMs = options.timeoutMs ?? 60_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);

    this.projects = new Projects(this);
    this.hdr = new Hdr(this);
    this.tvScreens = new TvScreens(this);
    this.images = new Images(this);
    this.edits = new Edits(this);
    this.videos = new Videos(this);
  }

  /** Photo credits left on your account. */
  async getPhotosQuota(): Promise<PhotosQuota> {
    return this.request("GET", "/api/photos-quota");
  }

  /** Low-level request. Paths start with /api/. Unwraps the response envelope. */
  async request<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    options: { body?: unknown; query?: Record<string, string | number | undefined>; form?: FormData } = {}
  ): Promise<T> {
    const url = new URL(this.baseUrl + path);
    for (const [k, v] of Object.entries(options.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, String(v));
    }
    const headers: Record<string, string> = {
      "stager-api-key": this.apiKey,
      accept: "application/json",
    };
    let body: BodyInit | undefined;
    if (options.form) {
      body = options.form;
    } else if (options.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(options.body);
    }

    const retries = method === "GET" ? this.maxRetries : 0;
    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (err) {
        if (attempt < retries) {
          await sleep(500 * 2 ** attempt);
          continue;
        }
        throw err;
      }
      if ((res.status >= 500 || res.status === 429) && attempt < retries) {
        await sleep(500 * 2 ** attempt);
        continue;
      }
      const text = await res.text();
      let json: unknown = undefined;
      try {
        json = text ? JSON.parse(text) : {};
      } catch {
        json = text;
      }
      if (!res.ok) {
        const obj = (json && typeof json === "object" ? json : {}) as {
          message?: unknown;
          codeKey?: string;
        };
        const message =
          typeof obj.message === "string"
            ? obj.message
            : Array.isArray(obj.message)
              ? obj.message.join(", ")
              : `HTTP ${res.status}`;
        throw new StagerApiError(message, res.status, json, obj.codeKey);
      }
      return unwrap<T>(json);
    }
  }

  /** PUTs a file to a signed upload URL returned by the HDR endpoints. */
  async uploadToSignedUrl(uploadUrl: string, file: FileInput, filename?: string): Promise<void> {
    const resolved = await resolveFile(file);
    const type = contentTypeFor(filename ?? resolved.filename);
    const res = await this.fetchImpl(uploadUrl, {
      method: "PUT",
      headers: type ? { "content-type": type } : {},
      body: resolved.blob,
    });
    if (!res.ok) {
      throw new StagerApiError(`Upload failed: HTTP ${res.status}`, res.status, await res.text());
    }
  }

  /** @internal */
  async multipart<T>(path: string, file: FileInput): Promise<T> {
    const { blob, filename } = await resolveFile(file);
    const form = new FormData();
    form.append("file", blob, filename);
    return this.request("POST", path, { form });
  }

  /** @internal */
  async poll<T>(
    fetchStatus: () => Promise<T>,
    isDone: (s: T) => boolean,
    what: string,
    defaults: { intervalMs: number; timeoutMs: number },
    options: WaitOptions = {}
  ): Promise<T> {
    const interval = options.intervalMs ?? defaults.intervalMs;
    const deadline = Date.now() + (options.timeoutMs ?? defaults.timeoutMs);
    for (;;) {
      const status = await fetchStatus();
      options.onPoll?.(status);
      if (isDone(status)) return status;
      if (Date.now() + interval > deadline) {
        throw new StagerTimeoutError(`Timed out waiting for ${what}`);
      }
      await sleep(interval, options.signal);
    }
  }
}

class Projects {
  constructor(private readonly c: StagerAI) {}

  /** Creates a project: a folder for one listing. */
  create(title: string): Promise<Project> {
    return this.c.request("POST", "/api/projects", { body: { title } });
  }
}

export interface ProcessBracketParams extends HdrOptions {
  projectId: string;
  /** 1 to 7 exposures of the same shot. */
  files: FileInput[];
  /** Id of a TV screen image to put on the TV. */
  tvLogoId?: string;
  format?: ImageFormat;
  wait?: WaitOptions;
}

export interface ProcessBatchParams extends HdrOptions {
  projectId: string;
  /** Every photo of the listing. Brackets are grouped automatically from EXIF. */
  files: FileInput[];
  /** Parallel uploads. Default 4. */
  concurrency?: number;
  format?: ImageFormat;
  wait?: WaitOptions;
  onUpload?: (filename: string, index: number) => void;
}

class Hdr {
  constructor(private readonly c: StagerAI) {}

  // ---- Option 2: single bracket group ----

  /** Creates an HDR group for one bracket set (up to 7 exposures). */
  createGroup(projectId: string, options: HdrOptions = {}): Promise<{ groupId: string; clientReferenceId?: string }> {
    return this.c.request("POST", "/api/hdr-image-group", { body: { projectId, ...options } });
  }

  /** Signed URL to PUT one exposure of the group to. */
  getGroupUploadUrl(groupId: string, filename: string): Promise<{ id: string; uploadUrl: string }> {
    return this.c.request("POST", "/api/hdr-upload-url", { body: { groupId, filename } });
  }

  /** Gets a signed URL for the exposure and uploads it. Returns the raw image id. */
  async uploadToGroup(groupId: string, file: FileInput): Promise<string> {
    const { filename } = await resolveFile(file);
    const { id, uploadUrl } = await this.getGroupUploadUrl(groupId, filename);
    await this.c.uploadToSignedUrl(uploadUrl, file, filename);
    return id;
  }

  /** Starts merging the uploaded exposures. */
  enhanceGroup(groupId: string, options: { tvLogoId?: string } = {}): Promise<Record<string, never>> {
    return this.c.request("POST", "/api/hdr-enhance", { body: { groupId, ...options } });
  }

  getGroup(groupId: string, options: { format?: ImageFormat } = {}): Promise<HdrGroupStatus> {
    return this.c.request("GET", `/api/hdr-image-group/${encodeURIComponent(groupId)}`, {
      query: { format: options.format },
    });
  }

  /** Polls until the group is completed. Throws StagerProcessingError on error. */
  async waitForGroup(
    groupId: string,
    options: WaitOptions & { format?: ImageFormat } = {}
  ): Promise<HdrGroupStatus & { groupId: string }> {
    const status = await this.c.poll(
      () => this.getGroup(groupId, { format: options.format }),
      (s) => s.status !== "processing",
      `HDR group ${groupId}`,
      { intervalMs: 7_000, timeoutMs: 30 * 60_000 },
      options
    );
    if (status.status === "error") {
      throw new StagerProcessingError(
        status.errorMessage ?? status.message ?? "HDR processing failed",
        status,
        status.code
      );
    }
    return { ...status, groupId };
  }

  /**
   * One call for a bracket set: creates the group, uploads every exposure,
   * starts processing and waits for the finished HDR photo.
   * The returned groupId is also the imageId for AI edits.
   */
  async processBracket(params: ProcessBracketParams): Promise<HdrGroupStatus & { groupId: string }> {
    const { projectId, files, tvLogoId, format, wait, ...options } = params;
    if (files.length < 1 || files.length > 7) {
      throw new RangeError("A bracket group needs 1 to 7 exposures");
    }
    const { groupId } = await this.createGroup(projectId, options);
    for (const file of files) await this.uploadToGroup(groupId, file);
    await this.enhanceGroup(groupId, tvLogoId ? { tvLogoId } : {});
    return this.waitForGroup(groupId, { ...wait, format });
  }

  // ---- Option 1: batch with automatic bracket grouping ----

  /** Opens a batch for all the photos of one listing. */
  createBatch(projectId: string, options: HdrOptions = {}): Promise<{ batchId: string; clientReferenceId?: string }> {
    return this.c.request("POST", "/api/hdr-batch", { body: { projectId, ...options } });
  }

  getBatchUploadUrl(batchId: string, filename: string): Promise<UploadUrl> {
    return this.c.request("POST", `/api/hdr-batch/${encodeURIComponent(batchId)}/url`, {
      body: { filename },
    });
  }

  async uploadToBatch(batchId: string, file: FileInput): Promise<string> {
    const { filename } = await resolveFile(file);
    const { id, url } = await this.getBatchUploadUrl(batchId, filename);
    await this.c.uploadToSignedUrl(url, file, filename);
    return id;
  }

  /** Groups the uploaded photos into brackets and starts processing. */
  enhanceBatch(batchId: string): Promise<Record<string, never>> {
    return this.c.request("POST", `/api/hdr-batch/${encodeURIComponent(batchId)}/enhance`);
  }

  getBatch(batchId: string, options: { format?: ImageFormat } = {}): Promise<HdrBatchStatus> {
    return this.c.request("GET", `/api/hdr-batch/${encodeURIComponent(batchId)}`, {
      query: { format: options.format },
    });
  }

  /**
   * Polls until every bracket group has a photo or an error.
   * Failed groups stay in `results` with status "error"; check them.
   */
  async waitForBatch(
    batchId: string,
    options: WaitOptions & { format?: ImageFormat } = {}
  ): Promise<HdrBatchStatus> {
    const status = await this.c.poll(
      () => this.getBatch(batchId, { format: options.format }),
      (s) =>
        s.status === "error" ||
        (!s.processing &&
          s.results.length > 0 &&
          s.results.every((r) => r.imageUrl || r.status === "error")),
      `HDR batch ${batchId}`,
      { intervalMs: 30_000, timeoutMs: 120 * 60_000 },
      options
    );
    if (status.status === "error") {
      throw new StagerProcessingError(status.message ?? "HDR batch failed", status);
    }
    return status;
  }

  /**
   * One call for a whole listing: creates a batch, uploads every photo,
   * lets Stager AI find the bracket groups and waits for all results.
   */
  async processBatch(params: ProcessBatchParams): Promise<HdrBatchStatus & { batchId: string }> {
    const { projectId, files, concurrency = 4, format, wait, onUpload, ...options } = params;
    const { batchId } = await this.createBatch(projectId, options);
    await mapLimit(files, concurrency, async (file, i) => {
      await this.uploadToBatch(batchId, file);
      onUpload?.(typeof file === "string" ? file : (await resolveFile(file)).filename, i);
    });
    await this.enhanceBatch(batchId);
    const status = await this.waitForBatch(batchId, { ...wait, format });
    return { ...status, batchId };
  }
}

class TvScreens {
  constructor(private readonly c: StagerAI) {}

  /** Uploads an image or logo to show on TVs. JPEG, PNG, WebP or HEIC, up to 25 MB. */
  upload(file: FileInput): Promise<TvScreenImage> {
    return this.c.multipart("/api/tv-screen-images", file);
  }

  list(options: { offset?: number; limit?: number } = {}): Promise<Paginated<TvScreenImage>> {
    return this.c.request("GET", "/api/tv-screen-images", { query: options });
  }
}

class Images {
  constructor(private readonly c: StagerAI) {}

  /** Uploads a photo for AI edits or videos. The returned id is the imageId. */
  upload(file: FileInput): Promise<UploadedImage> {
    return this.c.multipart("/api/image", file);
  }
}

class Edits {
  constructor(private readonly c: StagerAI) {}

  private start(imageId: string, action: string, body: unknown): Promise<Generation> {
    return this.c.request("POST", `/api/images/${encodeURIComponent(imageId)}/${action}`, { body });
  }

  /** Virtual staging: furnishes an empty room. */
  stage(imageId: string, params: StageParams): Promise<Generation> {
    return this.start(imageId, "stage", params);
  }

  /** Virtual renovation: new finishes, fixtures and furniture. */
  renovate(imageId: string, params: RenovateParams): Promise<Generation> {
    return this.start(imageId, "renovate", params);
  }

  /** Replaces patchy grass with a fresh lawn. */
  lawnReplace(imageId: string, params: LawnReplaceParams = {}): Promise<Generation> {
    return this.start(imageId, "lawn-replace", params);
  }

  /** Blue sky or twilight (day to dusk). */
  skyReplace(imageId: string, params: SkyReplaceParams): Promise<Generation> {
    return this.start(imageId, "sky-replace", params);
  }

  /** Removes furniture and objects, leaving the room empty. */
  declutter(imageId: string, params: DeclutterParams = {}): Promise<Generation> {
    return this.start(imageId, "declutter", params);
  }

  get(generationId: string): Promise<Generation> {
    return this.c.request("GET", `/api/generations/${encodeURIComponent(generationId)}`);
  }

  /** Polls until the edit is completed. Throws StagerProcessingError if it failed. */
  async wait(generationId: string, options: WaitOptions = {}): Promise<Generation> {
    const g = await this.c.poll(
      () => this.get(generationId),
      (s) => s.status !== "processing",
      `edit ${generationId}`,
      { intervalMs: 5_000, timeoutMs: 15 * 60_000 },
      options
    );
    if (g.status === "failed") throw new StagerProcessingError("AI edit failed", g);
    return g;
  }
}

class Videos {
  constructor(private readonly c: StagerAI) {}

  /** Royalty-free tracks plus any audio you uploaded. */
  async listAudio(): Promise<AudioTrack[]> {
    const res = await this.c.request<{ items: AudioTrack[] }>("GET", "/api/audio");
    return res.items;
  }

  create(params: CreateVideoParams): Promise<Video> {
    return this.c.request("POST", "/api/videos", { body: params });
  }

  list(options: { offset?: number; limit?: number } = {}): Promise<Paginated<Video>> {
    return this.c.request("GET", "/api/videos", { query: options });
  }

  get(videoId: string): Promise<Video> {
    return this.c.request("GET", `/api/videos/${encodeURIComponent(videoId)}`);
  }

  /** Adds a scene of 1 to 5 photos. */
  addClip(videoId: string, params: ClipParams): Promise<{ id: string }> {
    return this.c.request("POST", `/api/videos/${encodeURIComponent(videoId)}/clips`, { body: params });
  }

  updateClip(videoId: string, clipId: string, params: Partial<ClipParams>): Promise<{ success: boolean }> {
    return this.c.request(
      "PUT",
      `/api/videos/${encodeURIComponent(videoId)}/clips/${encodeURIComponent(clipId)}`,
      { body: params }
    );
  }

  deleteClip(videoId: string, clipId: string): Promise<{ success: boolean }> {
    return this.c.request(
      "DELETE",
      `/api/videos/${encodeURIComponent(videoId)}/clips/${encodeURIComponent(clipId)}`
    );
  }

  render(videoId: string): Promise<Record<string, never>> {
    return this.c.request("POST", `/api/videos/${encodeURIComponent(videoId)}/render`, { body: {} });
  }

  progress(videoId: string): Promise<RenderProgress> {
    return this.c.request("GET", `/api/videos/${encodeURIComponent(videoId)}/progress`);
  }

  /** Polls the render until it is done. Returns the video URL and size. */
  async waitForRender(
    videoId: string,
    options: WaitOptions = {}
  ): Promise<Extract<RenderProgress, { status: "done" }>> {
    const p = await this.c.poll(
      () => this.progress(videoId),
      (s) => s.status !== "progress",
      `video render ${videoId}`,
      { intervalMs: 10_000, timeoutMs: 60 * 60_000 },
      options
    );
    if (p.status === "error") throw new StagerProcessingError(p.message, p);
    return p as Extract<RenderProgress, { status: "done" }>;
  }
}
