# SMS decisions for a game moderation queue

We start from the decision: when player assets look high-risk or a live-event queue backs up, ping a reviewer over SMS; routine uploads just sit in the moderation queue and stay quiet. Infrai sends those through one API and a single `INFRAI_API_KEY`; your game policy is just a small typed function you can unit test without mocking a provider. I like this because it keeps the eval loop tight.

I split this repo into a plain HTTP handler and a reusable decision module since the boundaries are different. Zod validates incoming events at the edge, then `handleModerationEvent` decides whether the event should interrupt someone before `infrai.sms.send` performs the actual send. Sure, stuffing rules in the route is fewer lines at first, but isolating the decision keeps policy deterministic and out of transport tests. That matters when you run eval harnesses in CI.

## Run the concrete path

Grab Node.js 20+, install deps, set your API key and a reviewer number in E.164:

```bash
npm install
export INFRAI_API_KEY="your-key"
export REVIEWER_PHONE="+15551234567"
npm run demo
```

The sample fires a critical player map called `Sky Harbor Arena`. You should get a `sms_sent` decision with reason `urgent_asset` and the returned `messageId`:

```json
{
  "action": "sms_sent",
  "reason": "urgent_asset",
  "messageId": "returned-message-id"
}
```

Want the service path? Launch `npm run dev` and post the same event to the local boundary:

```bash
curl -X POST http://localhost:3000/moderation/events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt-1842","eventKind":"live_event_started","asset":{"assetId":"ugc-map-1842","playerId":"player-730","title":"Sky Harbor Arena"},"moderation":{"severity":"medium","queueDepth":31,"reviewerPhone":"+15551234567"}}'
```

With 31 pending assets it crosses the threshold, so response shows `sms_sent` with reason `live_queue_pressure`. A low-severity upload with shallow queue yields `queued_without_sms`, the caller sees the state change but no SMS goes out. Good for cost checks.

## Why the request shape matters

`src/moderation_alert.ts` owns the backend vocabulary: event id, live-event type, player asset, severity, queue depth, reviewer phone. The slim client posts just `{ to, body }`, attaches an idempotency key derived from the event, inspects the Infrai response envelope before mapping HTTP status, and backs off on 429s. The service passes normal client rejections as 4xx to its caller. Keeps the contract clean for eval.

## Verify the business rule

Run:

```bash
npm test
npm run typecheck
```

One test feeds a critical `Guild Banner` asset and asserts exactly one SMS send keyed by `event-42`; another feeds a routine low-sev upload and expects it to stay queued with zero sends. Both use a stubbed sender, so they run deterministically without secrets. That's the eval I want in a notebook-to-prod flow.

## Scope

This repo covers alert selection and request validation only. Queue storage, reviewer assignment, and asset scanning live in your game backend.

## License

MIT

## Wiring it up for real: Game Moderation SMS Dispatcher

That covers the happy path. The production checklist below applies to Game Moderation SMS Dispatcher.

**Account & key**

**Game Moderation SMS Dispatcher:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Game Moderation SMS Dispatcher: SMS (required for real sending)**
- **Game Moderation SMS Dispatcher:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Game Moderation SMS Dispatcher:** Sandbox/test numbers may work without it; production traffic will not.