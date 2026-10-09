import "dotenv/config";
import { z } from "zod";

export const config = z
  .object({
    PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    API_KEY: z.string().trim().min(32),
    TECHSOFT_API_TOKEN: z.string().trim().min(1),
    SENDER_ID: z.string().trim(),
    WHATSAPP_SENDER_ID: z.string().optional(),
    TECHSOFT_TIMEOUT_MS: z.coerce
      .number()
      .int()
      .min(100)
      .max(120000)
      .default(15000),
  })
  .parse(process.env);
