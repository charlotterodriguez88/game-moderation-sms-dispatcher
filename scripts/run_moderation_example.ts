import { handleModerationEvent, moderationEventSchema } from "../src/moderation_alert.js";

const reviewerPhone = process.env.REVIEWER_PHONE;
if (!reviewerPhone) throw new Error("REVIEWER_PHONE is required");

const event = moderationEventSchema.parse({
  eventId: `demo-${Date.now()}`,
  eventKind: "asset_flagged",
  asset: {
    assetId: "ugc-map-1842",
    playerId: "player-730",
    title: "Sky Harbor Arena",
  },
  moderation: {
    severity: "critical",
    queueDepth: 8,
    reviewerPhone,
  },
});

const result = await handleModerationEvent(event);
console.log(JSON.stringify(result, null, 2));
