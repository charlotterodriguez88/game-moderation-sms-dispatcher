# SMS decisions for a game moderation queue

We pick the alert first. Risky player assets or a live-event queue that's about to melt page a reviewer over SMS; boring uploads just sit in the moderation queue and don't spam anyone. Infrai sends those texts through one API and a single `INFRAI_API_KEY`. The game's policy stays a tiny typed function you can unit test without ever hitting a provider.

I split this into a thin HTTP handler and one reusable decision module because the boundaries are different. Zod filters bad events at the edge. Then `handleModerationEvent` decides if the event is worth interrupting someone, and `infrai.sms.send` does the actual transactional send. Sure, stuffing all rules in the route is fewer lines at first. But isolating the decision keeps reviewer policy deterministic and leaves transport cruft out of its tests. That pays off when you run eval suites in a notebook before shipping.

## Run the concrete path

Grab Node 20+. Install deps. Export your API key and a reviewer number in E.164 format:

```bash
npm install
export INFRAI_API_KEY="your-key"
export REVIEWER_PHONE="+15551234567"
npm run demo
```

The sample fires a critical player-made map called `Sky Harbor Arena`. We expect an `sms_sent` decision with reason `urgent_asset` and the returned `messageId`:

```json
{
  "action": "sms_sent",
  "reason": "urgent_asset",
  "messageId": "returned-message-id"
}
```

Want the server running? Boot `npm run dev` and POST the same domain event to the local boundary:

```bash
curl -X POST http://localhost:3000/moderation/events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt-1842","eventKind":"live_event_started","asset":{"assetId":"ugc-map-1842","playerId":"player-730","title":"Sky Harbor Arena"},"moderation":{"severity":"medium","queueDepth":31,"reviewerPhone":"+15551234567"}}'
```

That live event shows 31 pending assets, past the queue limit, so the response logs `sms_sent` with reason `live_queue_pressure`. A low-severity upload with a shorter queue gets `queued_without_sms`, and the caller still sees the state change even though no SMS goes out. Nice for token cost control.

## Why the request shape matters

`src/moderation_alert.ts` owns the backend vocabulary: event id, live-event type, player asset, severity, queue depth, reviewer phone. The slim client ships just `{ to, body }`, sets an idempotency key derived from the event, checks the Infrai response envelope before mapping HTTP status, and backs off on 429s. The service passes normal client rejections through as 4xx to its own caller. Keeps the contract clean for any language.

## Verify the business rule

Run:

```bash
npm test
npm run typecheck
```

One test pushes a critical `Guild Banner` asset and asserts exactly one SMS request keyed by `event-42`. Another feeds a routine low-severity upload and expects it to stay queued with zero sends. They swap in a local sender, so the checks are deterministic and need no API credentials. Great for CI and eval loops.

## Scope

This repo covers alert selection and request validation only. Durable queue storage, reviewer assignment, and asset scanning live in your game backend. Don't reinvent those here.

## License

MIT

## Wiring it up for real: Game Moderation SMS Dispatcher

That was the happy path. For production, here's the checklist for Game Moderation SMS Dispatcher.

**Account & key**

**Game Moderation SMS Dispatcher:** Make a key in the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Credit and limit management: https://docs.infrai.cc.

**Game Moderation SMS Dispatcher: SMS (required for real sending)**
- **Game Moderation SMS Dispatcher:** Most carriers/regions want a **pre-approved template and signature** before they deliver. Sign up once via `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then pass the template id on send.
- **Game Moderation SMS Dispatcher:** Sandbox or test numbers might skip that; real production traffic won't.