import express, { type ErrorRequestHandler } from "express";
import helmet from "helmet";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { ProviderError } from "./techsoft.js";

const phone = z
  .string()
  .regex(/^\+?[1-9]\d{6,14}$/, "Use an international phone number");
const recipients = z
  .string()
  .transform((s) => s.split(",").map((n) => n.trim()))
  .pipe(z.array(phone).min(1).max(100))
  .transform((a) => a.map((n) => n.replace(/^\+/, "")).join(","));
const schedule = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/)
  .refine((s) => {
    const d = new Date(s.replace(" ", "T") + ":00Z");
    return (
      !Number.isNaN(d.getTime()) &&
      d.toISOString().slice(0, 16).replace("T", " ") === s
    );
  }, "Invalid calendar date");

const common = {
  message: z.string().trim().min(1).max(10000),
  schedule_time: schedule.optional(),
};

const sms = z
  .object({
    ...common,
    recipient: recipients,
    dlt_template_id: z.string().min(1).optional(),
  })
  .strict();

const whatsapp = z
  .object({
    ...common,
    recipient: phone.transform((n) => n.replace(/^\+/, "")),
    media_url: z
      .url()
      .refine((s) => ["https:", "http:"].includes(new URL(s).protocol))
      .optional(),
    delay: z.literal("no").optional(),
  })
  .strict();

const query = z
  .object({
    page: z
      .string()
      .regex(/^[1-9]\d*$/)
      .optional(),
    start_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      .optional(),
    end_date: z
      .string()
      .regex(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)
      .optional(),
    timezone: z
      .string()
      .refine((s) => {
        try {
          new Intl.DateTimeFormat("en", { timeZone: s });
          return true;
        } catch {
          return false;
        }
      })
      .optional(),
    sms_type: z
      .enum(["plain", "unicode", "voice", "mms", "whatsapp", "otp", "viber"])
      .optional(),
    direction: z.enum(["outgoing", "incoming", "api"]).optional(),
  })
  .strict()
  .refine(
    (q) => Boolean(q.start_date) === Boolean(q.end_date),
    "Both dates are required"
  )
  .refine(
    (q) => !q.start_date || !q.end_date || q.start_date < q.end_date,
    "start_date must precede end_date"
  );

export function createApp(
  apiKey: string,
  provider: (path: string, body?: unknown) => Promise<unknown>,
  senders: { sms: string; whatsapp: string }
) {
  const app = express();

  app.disable("x-powered-by");

  app.use(helmet());

  app.get("/health", (_req, res) => res.json({ status: "ok" }));

  app.use("/api", (req, res, next) => {
    const actual = Buffer.from(req.get("authorization") ?? "");
    const expected = Buffer.from(`Bearer ${apiKey}`);
    if (
      actual.length !== expected.length ||
      !timingSafeEqual(actual, expected)
    ) {
      res.status(401).json({ status: "error", message: "Unauthorized" });
      return;
    }
    next();
  });

  app.use(express.json({ limit: "64kb" }));

  app.post("/api/sms/send", async (req, res) =>
    res.json(
      await provider("/sms/send", { ...sms.parse(req.body), sender_id: senders.sms, type: "plain" })
    )
  );

  app.post("/api/whatsapp/send", async (req, res) =>
    res.json(
      await provider("/sms/send", {
        ...whatsapp.parse(req.body),
        sender_id: senders.whatsapp,
        type: "whatsapp",
      })
    )
  );

  app.get("/api/whatsapp/check/:number", async (req, res) =>
    res.json(
      await provider(
        `/check_number/${encodeURIComponent(
          phone.parse(req.params.number).replace(/^\+/, "")
        )}`
      )
    )
  );

  app.get("/api/messages", async (req, res) => {
    const filters = query.parse(req.query);
    const search = new URLSearchParams(
      Object.entries(filters).filter(
        (entry): entry is [string, string] => entry[1] !== undefined
      )
    );
    res.json(
      await provider(`/sms${search.size ? "?" + search.toString() : ""}`)
    );
  });

  app.get("/api/messages/:uid", async (req, res) =>
    res.json(
      await provider(
        `/sms/${encodeURIComponent(
          z
            .string()
            .regex(/^[a-zA-Z0-9_-]+$/)
            .parse(req.params.uid)
        )}`
      )
    )
  );

  app.use((_req, res) =>
    res.status(404).json({ status: "error", message: "Route not found" })
  );

  const errorHandler: ErrorRequestHandler = (error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        status: "error",
        message: "Invalid input",
        errors: error.issues,
      });
      return;
    }
    if (error instanceof ProviderError) {
      res.status(error.statusCode).json(error.response);
      return;
    }
    if (error?.type === "entity.too.large") {
      res.status(413).json({ status: "error", message: "Payload too large" });
      return;
    }
    if (error instanceof SyntaxError && "body" in error) {
      res.status(400).json({ status: "error", message: "Invalid JSON" });
      return;
    }
    console.error("Unexpected request error");
    res.status(500).json({ status: "error", message: "Internal server error" });
  };
  app.use(errorHandler);
  return app;
}
