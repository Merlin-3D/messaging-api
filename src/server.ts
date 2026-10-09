import { config } from "./config.js";
import { createApp } from "./app.js";
import { createTechsoft } from "./techsoft.js";

const server = createApp(
  config.API_KEY,
  createTechsoft(config.TECHSOFT_API_TOKEN, config.TECHSOFT_TIMEOUT_MS),
  { sms: config.SENDER_ID, whatsapp: config.WHATSAPP_SENDER_ID ?? config.SENDER_ID }
).listen(config.PORT, "0.0.0.0", () =>
  console.log(`Messaging API listening on port ${config.PORT}`)
);
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 10000).unref();
  });
}
