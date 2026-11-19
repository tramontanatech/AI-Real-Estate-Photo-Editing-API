"""Receive Stager AI webhooks with Flask instead of polling.

    pip install stagerai flask
    STAGER_WEBHOOK_SECRET=your_secret flask --app webhook_flask run

Set https://your-server/webhooks/stager as the webhook URL on your Stager AI
account page, under API Access.
"""

import os

from flask import Flask, abort, request

from stagerai import StagerError, construct_webhook_event

app = Flask(__name__)
SECRET = os.environ["STAGER_WEBHOOK_SECRET"]
seen = set()  # use your database in production


@app.post("/webhooks/stager")
def stager_webhook():
    try:
        # Verify the raw bytes: re-serialized JSON would not match the signature.
        event = construct_webhook_event(request.get_data(), request.headers, SECRET)
    except StagerError:
        abort(400)

    if event["eventId"] in seen:
        return "ok"
    seen.add(event["eventId"])

    data = event["data"]
    if event["eventType"] == "hdr.image.completed":
        print(f"HDR ready for {data.get('clientReferenceId') or data['groupId']}: {data['imageUrl']}")
    elif event["eventType"] == "hdr.image.failed":
        print(f"HDR failed (code {data['errorCode']}): {data['message']}")
    elif event["eventType"] == "edit.completed":
        print(f"{data['actionType']} ready: {data['imageUrl']}")
    elif event["eventType"] == "edit.failed":
        print(f"{data['actionType']} failed: {data['message']}")
    return "ok"
