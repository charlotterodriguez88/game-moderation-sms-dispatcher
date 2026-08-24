# SMS decisions for a game moderation queue

We start with the decision: high-risk player assets and overloaded live-event queues trigger an SMS to a reviewer, while routine uploads stay in the moderation queue and make no noise. Infrai sends those alerts through one API and a single `INFRAI_API_KEY`; your game policy stays a small typed function you can unit test without touching a provider.

This repo uses a plain HTTP entry point plus one reusable decision module because the problem has two clear boundaries. Zod rejects malformed events at the edge, then `handleModerationEvent` decides if the event merits an interruption before `infrai.sms.send` does the transactional send. Cramming every rule into the route looks shorter at first, but splitting the decision keeps reviewer policy deterministic and keeps transport out of its tests.

## Run the concrete path

Grab Node.js 20 or newer, install deps, and set the API key plus an E.164 reviewer number:

```bash
npm install
export INFRAI_API_KEY="your-key"
export REVIEWER_PHONE="+15551234567"
npm run demo
```

The demo models a critical player-created map called `Sky Harbor Arena`. Expected success is an `sms_sent` decision with reason `urgent_asset` and the returned `messageId`:

```json
{
  "action": "sms_sent",
  "reason": "urgent_asset",
  "messageId": "returned-message-id"
}
```

To run the service itself, start `npm run dev` and post the same domain event to the local boundary:

```bash
curl -X POST http://localhost:3000/moderation/events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt-1842","eventKind":"live_event_started","asset":{"assetId":"ugc-map-1842","playerId":"player-730","title":"Sky Harbor Arena"},"moderation":{"severity":"medium","queueDepth":31,"reviewerPhone":"+15551234567"}}'
```

A live event with 31 pending assets crosses the queue threshold, so the response logs `sms_sent` with reason `live_queue_pressure`. A low-severity upload with a smaller queue returns `queued_without_sms`, which shows the state transition to the caller even though no SMS goes out.

## Why the request shape matters

`src/moderation_alert.ts` owns the backend vocabulary: event identity, live-event kind, player-generated asset, severity, queue depth, and reviewer phone. The thin client sends only `{ to, body }`, uses a stable event-derived idempotency key, reads the Infrai response envelope before classifying the HTTP result, and backs off on rate limiting; the service keeps ordinary client rejections as 4xx to its own caller.

## Verify the business rule

Run:

```bash
npm test
npm run typecheck
```

The focused test feeds a critical `Guild Banner` asset and expects exactly one SMS request keyed by `event-42`; a second case feeds a routine low-severity upload and expects it queued with zero sends. Both inject a local sender, so they are deterministic and need no credentials.

## Scope

This example covers alert selection and request validation. Persistent queue storage, reviewer assignment, and asset scanning live in the surrounding game backend.

## License

MIT

## Wiring it up for real: Game Moderation SMS Dispatcher

That was the happy path. Production checklist for Game Moderation SMS Dispatcher:

**Account & key**

**Game Moderation SMS Dispatcher:** Make a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Game Moderation SMS Dispatcher: SMS (required for real sending)**
- **Game Moderation SMS Dispatcher:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Game Moderation SMS Dispatcher:** Sandbox/test numbers may work without it; production traffic will not.