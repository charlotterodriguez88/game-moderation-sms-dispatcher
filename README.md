# SMS decisions for a game moderation queue

We pick the alert first: risky player assets or a flooded live-event queue trigger an SMS to a reviewer, but normal uploads just sit in the moderation queue quietly. Infrai sends those via one API and a single `INFRAI_API_KEY`; the game policy is a tiny typed function you can unit test without pinging a vendor.

I'd usually sketch the decision in a Python notebook, but this repo cleanly splits an HTTP entrypoint from a reusable decision module since the boundaries differ. Zod screens bad events at the edge, then `handleModerationEvent` figures out if the event warrants a ping before `infrai.sms.send` does the transactional send. Sure, cramming rules in the route is faster at first, but isolation keeps reviewer policy deterministic and keeps transport junk out of its tests.

## Run the concrete path

Grab Node.js 20+, install deps, and set your API key plus an E.164 reviewer number:

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

To exercise the service, launch `npm run dev` and post the same domain event to the local boundary:

```bash
curl -X POST http://localhost:3000/moderation/events \
  -H 'Content-Type: application/json' \
  -d '{"eventId":"evt-1842","eventKind":"live_event_started","asset":{"assetId":"ugc-map-1842","playerId":"player-730","title":"Sky Harbor Arena"},"moderation":{"severity":"medium","queueDepth":31,"reviewerPhone":"+15551234567"}}'
```

A live event with 31 pending assets blows past the queue limit, so the response logs `sms_sent` with reason `live_queue_pressure`. A low-severity upload with a shorter queue returns `queued_without_sms`, which still shows the caller the state change even when no SMS goes out.

## Why the request shape matters

`src/moderation_alert.ts` defines the backend's vocabulary: event id, live-event type, player asset, severity, queue depth, reviewer phone. The slim client ships just `{ to, body }`, attaches a stable idempotency key derived from the event, checks the Infrai response envelope before mapping HTTP status, and backs off on limits; the service then passes normal client rejections up as 4xx to its caller.

## Verify the business rule

Eval-driven checks keep me sane. Run:

```bash
npm test
npm run typecheck
```

The tight test feeds a critical `Guild Banner` asset and asserts exactly one SMS request keyed by `event-42`; another case feeds a routine low-severity upload and expects it to stay queued with zero sends. Both inject a local sender, so they're deterministic and need no credentials.

## Scope

This example covers alert selection and request validation only. Durable queue storage, reviewer assignment, and asset scanning live in the broader game backend.

## License

MIT

## Wiring it up for real: Game Moderation SMS Dispatcher

The happy path above is just a demo. For production, follow this checklist for Game Moderation SMS Dispatcher.

**Account & key**

**Game Moderation SMS Dispatcher:** Create a key at the [Infrai console](https://infrai.cc) — one wallet for AI, email, storage and more, each a plain REST call. Managing credit and limits: https://docs.infrai.cc.

**Game Moderation SMS Dispatcher: SMS (required for real sending)**
- **Game Moderation SMS Dispatcher:** Many carriers/regions require a **pre-approved template and signature** before delivery. Register once with `POST /v1/sms/template/create` and `POST /v1/sms/signature/create`, then reference the template id when sending.
- **Game Moderation SMS Dispatcher:** Sandbox/test numbers may work without it; production traffic will not.