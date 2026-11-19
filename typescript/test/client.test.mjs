import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import {
  StagerAI,
  StagerApiError,
  StagerProcessingError,
  isValidWebhookSignature,
  constructWebhookEvent,
  signWebhook,
  contentTypeFor,
} from "../dist/esm/index.js";

/** A fake fetch that answers from a list of [matcher, response] routes and records calls. */
function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init = {}) => {
    const u = String(url);
    const method = init.method ?? "GET";
    calls.push({ url: u, method, init });
    for (const [match, respond] of routes) {
      if (match(method, u)) {
        const r = typeof respond === "function" ? respond(u, init, calls) : respond;
        const status = r.status ?? 200;
        return new Response(r.body === undefined ? "" : JSON.stringify(r.body), { status });
      }
    }
    throw new Error(`Unexpected request ${method} ${u}`);
  };
  fn.calls = calls;
  return fn;
}
const on = (m, path) => (method, url) => method === m && url.includes(path);

test("sends the api key header and unwraps the response envelope", async () => {
  const fetch = fakeFetch([
    [on("POST", "/api/projects"), { body: { status: "success", data: { id: "p1", title: "123 Main St" } } }],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  const project = await stager.projects.create("123 Main St");
  assert.deepEqual(project, { id: "p1", title: "123 Main St" });
  assert.equal(fetch.calls[0].init.headers["stager-api-key"], "k");
  assert.equal(fetch.calls[0].url, "https://api.stagerai.com/api/projects");
  assert.deepEqual(JSON.parse(fetch.calls[0].init.body), { title: "123 Main St" });
});

test("leaves non-envelope bodies alone", async () => {
  const fetch = fakeFetch([
    [on("GET", "/progress"), { body: { status: "progress", progress: 45 } }],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  assert.deepEqual(await stager.videos.progress("v1"), { status: "progress", progress: 45 });
});

test("throws StagerApiError with the API message on 4xx", async () => {
  const fetch = fakeFetch([
    [on("POST", "/api/hdr-upload-url"), { status: 400, body: { message: "group already enhanced" } }],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  await assert.rejects(stager.hdr.getGroupUploadUrl("g1", "a.jpg"), (err) => {
    assert.ok(err instanceof StagerApiError);
    assert.equal(err.status, 400);
    assert.equal(err.message, "group already enhanced");
    return true;
  });
});

test("retries GET requests on 5xx", async () => {
  let n = 0;
  const fetch = fakeFetch([
    [on("GET", "/api/photos-quota"), () => (++n < 2 ? { status: 503, body: {} } : { body: { success: true, data: { photosQuota: 9 } } })],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  assert.deepEqual(await stager.getPhotosQuota(), { photosQuota: 9 });
  assert.equal(n, 2);
});

test("processBracket creates, uploads with the signed content type, enhances and waits", async () => {
  let polls = 0;
  const fetch = fakeFetch([
    [on("POST", "/api/hdr-image-group"), { body: { status: "success", data: { groupId: "g1" } } }],
    [on("POST", "/api/hdr-upload-url"), (u, init) => ({ body: { status: "success", data: { id: "r", uploadUrl: "https://storage.example/" + JSON.parse(init.body).filename } } })],
    [on("PUT", "https://storage.example/"), { body: undefined }],
    [on("POST", "/api/hdr-enhance"), { body: { status: "success", data: {} } }],
    [on("GET", "/api/hdr-image-group/g1"), () => ({ body: { status: "success", data: ++polls < 2 ? { status: "processing" } : { status: "completed", imageUrl: "https://out.jpg" } } })],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  const result = await stager.hdr.processBracket({
    projectId: "p1",
    files: [
      { data: new Uint8Array([1]), filename: "a.JPG" },
      { data: new Uint8Array([2]), filename: "b.CR3" },
    ],
    skyReplacement: false,
    tvLogoId: "tv1",
    format: "png",
    wait: { intervalMs: 1 },
  });
  assert.equal(result.imageUrl, "https://out.jpg");
  assert.equal(result.groupId, "g1");

  const create = fetch.calls.find((c) => c.url.endsWith("/api/hdr-image-group"));
  assert.deepEqual(JSON.parse(create.init.body), { projectId: "p1", skyReplacement: false });
  const puts = fetch.calls.filter((c) => c.method === "PUT");
  assert.equal(puts[0].init.headers["content-type"], "image/jpeg");
  assert.equal(puts[1].init.headers["content-type"], undefined, "raw files are sent without a content type");
  const enhance = fetch.calls.find((c) => c.url.endsWith("/api/hdr-enhance"));
  assert.deepEqual(JSON.parse(enhance.init.body), { groupId: "g1", tvLogoId: "tv1" });
  assert.ok(fetch.calls.at(-1).url.endsWith("/api/hdr-image-group/g1?format=png"));
});

test("waitForGroup throws StagerProcessingError with the HDR error code", async () => {
  const fetch = fakeFetch([
    [on("GET", "/api/hdr-image-group/g1"), { body: { status: "success", data: { status: "error", code: 11, errorMessage: "Failed to align" } } }],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  await assert.rejects(stager.hdr.waitForGroup("g1"), (err) => {
    assert.ok(err instanceof StagerProcessingError);
    assert.equal(err.code, 11);
    return true;
  });
});

test("waitForBatch finishes once every group has a photo or an error", async () => {
  let polls = 0;
  const fetch = fakeFetch([
    [on("GET", "/api/hdr-batch/b1"), () => {
      polls++;
      const done = polls >= 2;
      return { body: { status: "success", data: {
        processing: !done,
        status: "processing",
        results: [
          { groupId: "g1", imageUrl: "https://1.jpg" },
          done ? { groupId: "g2", status: "error", code: 1 } : { groupId: "g2", processing: true },
        ],
      } } };
    }],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  const batch = await stager.hdr.waitForBatch("b1", { intervalMs: 1 });
  assert.equal(polls, 2);
  assert.equal(batch.results[1].code, 1);
});

test("edits.wait returns the finished generation", async () => {
  const fetch = fakeFetch([
    [on("POST", "/api/images/img1/stage"), { body: { status: "success", data: { generationId: "gen1", status: "processing" } } }],
    [on("GET", "/api/generations/gen1"), { body: { status: "success", data: { generationId: "gen1", status: "completed", imageUrl: "https://staged.jpg" } } }],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  const { generationId } = await stager.edits.stage("img1", { roomType: "LIVING_ROOM", roomStyle: "modern" });
  const result = await stager.edits.wait(generationId);
  assert.equal(result.imageUrl, "https://staged.jpg");
});

test("images.upload sends multipart with the file field", async () => {
  const fetch = fakeFetch([
    [on("POST", "/api/image"), { body: { success: true, data: { id: "img1" } } }],
  ]);
  const stager = new StagerAI({ apiKey: "k", fetch });
  const img = await stager.images.upload({ data: new Uint8Array([1, 2]), filename: "room.jpg" });
  assert.equal(img.id, "img1");
  const form = fetch.calls[0].init.body;
  assert.ok(form instanceof FormData);
  assert.equal(form.get("file").name, "room.jpg");
});

test("webhook signatures", () => {
  const body = JSON.stringify({ eventId: "e1", eventType: "edit.completed", data: {} });
  const ts = "1700000000000";
  const headers = { "X-Stager-Signature": signWebhook(body, ts, "secret"), "X-Stager-Timestamp": ts };
  const now = 1700000000000 + 1000;
  assert.equal(isValidWebhookSignature(body, headers, "secret", { now }), true);
  assert.equal(isValidWebhookSignature(body, headers, "wrong", { now }), false);
  assert.equal(isValidWebhookSignature(body + " ", headers, "secret", { now }), false);
  assert.equal(isValidWebhookSignature(body, headers, "secret", { now: now + 10 * 60_000 }), false);
  assert.equal(constructWebhookEvent(body, new Headers(headers), "secret", { now }).eventId, "e1");
});

test("contentTypeFor mirrors the signed URL bindings", () => {
  assert.equal(contentTypeFor("x.jpeg"), "image/jpeg");
  assert.equal(contentTypeFor("x.TIF"), "image/tiff");
  assert.equal(contentTypeFor("x.nef"), undefined);
});

test("the CommonJS build loads with require()", () => {
  const require = createRequire(import.meta.url);
  const cjs = require("../dist/cjs/index.js");
  assert.equal(typeof cjs.StagerAI, "function");
});
