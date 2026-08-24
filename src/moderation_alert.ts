import { z } from "zod";
import { infrai, type SmsReceipt } from "./infrai_sms.js";

export const moderationEventSchema = z.object({
  eventId: z.string().min(1).max(100),
  eventKind: z.enum(["asset_uploaded", "asset_flagged", "live_event_started"]),
  asset: z.object({
    assetId: z.string().min(1).max(100),
    playerId: z.string().min(1).max(100),
    title: z.string().min(1).max(80),
  }),
  moderation: z.object({
    severity: z.enum(["low", "medium", "high", "critical"]),
    queueDepth: z.number().int().nonnegative(),
    reviewerPhone: z.string().regex(/^\+[1-9]\d{7,14}$/),
  }),
});

export type ModerationEvent = z.infer<typeof moderationEventSchema>;
export type AlertDecision =
  | { action: "queued_without_sms"; reason: "routine_review" }
  | { action: "sms_sent"; reason: "urgent_asset" | "live_queue_pressure"; messageId: string };

export type SmsSender = (
  payload: { to: string; body: string },
  idempotencyKey: string,
) => Promise<SmsReceipt>;

export function decideAlert(event: ModerationEvent): "urgent_asset" | "live_queue_pressure" | null {
  if (event.moderation.severity === "critical" || event.moderation.severity === "high") {
    return "urgent_asset";
  }
  if (event.eventKind === "live_event_started" && event.moderation.queueDepth >= 25) {
    return "live_queue_pressure";
  }
  return null;
}

export async function handleModerationEvent(
  event: ModerationEvent,
  sendSms: SmsSender = infrai.sms.send,
): Promise<AlertDecision> {
  const reason = decideAlert(event);
  if (!reason) return { action: "queued_without_sms", reason: "routine_review" };

  const body = reason === "urgent_asset"
    ? `Moderation alert: ${event.moderation.severity} risk asset "${event.asset.title}" (${event.asset.assetId}) from player ${event.asset.playerId}.`
    : `Live event queue alert: ${event.moderation.queueDepth} assets await review; newest asset is ${event.asset.assetId}.`;
  const receipt = await sendSms(
    { to: event.moderation.reviewerPhone, body },
    `moderation-event:${event.eventId}`,
  );
  return { action: "sms_sent", reason, messageId: receipt.message_id };
}
