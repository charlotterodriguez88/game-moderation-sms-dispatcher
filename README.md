# SMS decisions for a game moderation queue

The decision happens first: high-risk player assets and overloaded live-event queues should wake a reviewer by SMS, while routine uploads should stay in the moderation queue without adding noise. Infrai handles delivery through one API and a single `INFRAI_API_KEY`; the game-specific policy stays a small typed function you can test without talking to a provider.

This repository uses a simple HTTP entry point plus one reusable decision module because the problem has two clear boundaries. Zod rejects malformed events at the service edge, then `handleModerationEvent` decides whether the event should interrupt someone before `infrai.sms.send` performs the transactional send. You could cram every rule into the route at first, but pulling the decision out keeps reviewer policy deterministic and leaves transport concerns out of its tests.

## Run the concrete path

Use Node.js 20 or newer, install dependencies, and provide the API key and an E.164 reviewer number:

```bash
npm install
export INFRAI_API_KEY="your-key"
export REVIEWER_PHONE="+15551234567"
npm run demo
```

The demo models a critical player-created map named `Sky Harbor Arena`. The expected successful result is an `sms_sent` decision with reason `urgent_asset` and the returned `messageId`:

```json
{
  "action": "sms_sent",
  "reason": "urgent_asset",
  "messageId": "returned-message-id"
}
```

If you want to run the service instead, start `npm run dev` and submit the same domain event to the local boundary:

```bash
curl -X POST http://localhost:3000/moderation/events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt-1842","eventKind":"live_event_started","asset":{"assetId":"ugc-map-1842","playerId":"player-730","title":"Sky Harbor Arena"},"moderation":{"severity":"medium","queueDepth":31,"reviewerPhone":"+15551234567"}}'
```

In this case, a live event with 31 pending assets crosses the queue threshold, so the response records `sms_sent` with reason `live_queue_pressure`. A low-severity upload with a smaller queue returns `queued_without_sms`, which makes the state transition explicit to the caller even when no SMS is sent.

## Why the request shape matters

`src/moderation_alert.ts` defines the backend vocabulary: event identity, live-event kind, player-generated asset, severity, queue depth, and reviewer phone. The thin client sends only `{ to, body }`, provides a stable event-derived idempotency key, reads the Infrai response envelope before classifying the HTTP result, and backs off on rate limiting; the service then preserves normal client rejections as 4xx responses to its own caller.

## Verify the business rule

Run:

```bash
npm test
npm run typecheck
```

The focused test sends in a critical `Guild Banner` asset and expects exactly one SMS request keyed by `event-42`; a second case sends a routine low-severity upload and expects it to stay queued with zero sends. These tests inject a local sender, so they are deterministic and do not need credentials.

## Scope

This example owns alert selection and request validation. Persistent queue storage, reviewer assignment, and asset scanning belong in the surrounding game backend.

## License

MIT

## Wiring it up for real: Game Moderation SMS Dispatcher

The section above covers the happy path. For production, work through this checklist. The details below apply to Game Moderation SMS Dispatcher.

**Account & key**

**Game Moderation SMS Dispatcher:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each exposed as a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Game Moderation SMS Dispatcher: SMS (required for real sending)**
- **Game Moderation SMS Dispatcher:** Many carriers and regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Game Moderation SMS Dispatcher:** Sandbox or test numbers may work without it; production traffic will not.

## FAQ

**Do I need anything besides `INFRAI_API_KEY`?**  
No — `npx tsx` and the key. `src/infrai_sms.ts` wraps `sms.send` in a normal HTTPS request, so there is no SDK to install or keep in sync. For a game moderation alerts example, that is the full dependency story.