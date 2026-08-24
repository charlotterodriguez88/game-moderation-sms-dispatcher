import { createServer } from "node:http";
import { InfraiError } from "./infrai_sms.js";
import { handleModerationEvent, moderationEventSchema } from "./moderation_alert.js";

const port = Number(process.env.PORT ?? 3000);

createServer(async (request, response) => {
  response.setHeader("Content-Type", "application/json");
  if (request.method !== "POST" || request.url !== "/moderation/events") {
    response.writeHead(404).end(JSON.stringify({ error: "route_not_found" }));
    return;
  }

  try {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const parsed = moderationEventSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
    if (!parsed.success) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_request", issues: parsed.error.issues }));
      return;
    }
    const result = await handleModerationEvent(parsed.data);
    response.writeHead(200).end(JSON.stringify(result));
  } catch (error) {
    if (error instanceof SyntaxError) {
      response.writeHead(400).end(JSON.stringify({ error: "invalid_json" }));
      return;
    }
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      response.writeHead(status).end(JSON.stringify({ error: error.code, message: error.message }));
      return;
    }
    response.writeHead(500).end(JSON.stringify({ error: "service_error" }));
  }
}).listen(port, () => {
  console.log(`Game moderation alert service listening on http://localhost:${port}`);
});
