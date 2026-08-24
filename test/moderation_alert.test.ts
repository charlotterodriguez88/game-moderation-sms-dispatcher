import assert from "node:assert/strict";
import test from "node:test";
import { handleModerationEvent, moderationEventSchema } from "../src/moderation_alert.js";

const baseEvent = {
  eventId: "event-42",
  eventKind: "asset_uploaded" as const,
  asset: { assetId: "asset-9", playerId: "player-3", title: "Guild Banner" },
  moderation: { severity: "low" as const, queueDepth: 4, reviewerPhone: "+15551234567" },
};

test("a critical player asset sends one deterministic reviewer alert", async () => {
  const event = moderationEventSchema.parse({
    ...baseEvent,
    moderation: { ...baseEvent.moderation, severity: "critical" },
  });
  const calls: Array<{ payload: { to: string; body: string }; key: string }> = [];
  const result = await handleModerationEvent(event, async (payload, key) => {
    calls.push({ payload, key });
    return { message_id: "sms-101" };
  });

  assert.deepEqual(result, { action: "sms_sent", reason: "urgent_asset", messageId: "sms-101" });
  assert.equal(calls.length, 1);
  assert.equal(calls[0]?.key, "moderation-event:event-42");
  assert.match(calls[0]?.payload.body ?? "", /Guild Banner/);
});

test("routine review remains queued and does not call the SMS sender", async () => {
  let sendCount = 0;
  const result = await handleModerationEvent(moderationEventSchema.parse(baseEvent), async () => {
    sendCount += 1;
    return { message_id: "unexpected" };
  });

  assert.deepEqual(result, { action: "queued_without_sms", reason: "routine_review" });
  assert.equal(sendCount, 0);
});
