// Receive Stager AI webhooks instead of polling. No framework needed.
//
//   npm install stagerai
//   STAGER_WEBHOOK_SECRET=your_secret node webhook-server.mjs
//
// Then set https://your-server/webhooks/stager as the webhook URL on your
// Stager AI account page, under API Access.

import { createServer } from "node:http";
import { constructWebhookEvent } from "stagerai";

const secret = process.env.STAGER_WEBHOOK_SECRET;
const seen = new Set(); // use your database in production

createServer(async (req, res) => {
  if (req.method !== "POST" || req.url !== "/webhooks/stager") {
    res.writeHead(404).end();
    return;
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const rawBody = Buffer.concat(chunks); // verify the raw bytes, not re-serialized JSON

  let event;
  try {
    event = constructWebhookEvent(rawBody, req.headers, secret);
  } catch {
    res.writeHead(400).end("invalid signature");
    return;
  }

  if (!seen.has(event.eventId)) {
    seen.add(event.eventId);
    switch (event.eventType) {
      case "hdr.image.completed":
        console.log(`HDR ready for ${event.data.clientReferenceId ?? event.data.groupId}: ${event.data.imageUrl}`);
        break;
      case "hdr.image.failed":
        console.log(`HDR failed (code ${event.data.errorCode}): ${event.data.message}`);
        break;
      case "edit.completed":
        console.log(`${event.data.actionType} ready: ${event.data.imageUrl}`);
        break;
      case "edit.failed":
        console.log(`${event.data.actionType} failed: ${event.data.message}`);
        break;
    }
  }
  res.writeHead(200).end("ok");
}).listen(3000, () => console.log("Listening on http://localhost:3000/webhooks/stager"));
