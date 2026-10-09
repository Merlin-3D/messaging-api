import { test } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createApp } from "../src/app.js";
import { createTechsoft, ProviderError } from "../src/techsoft.js";

test("HTTP authentication, validation and channel mapping", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const server = createApp(
    "test-secret",
    async (path, body) => {
      calls.push({ path, body });
      return { status: "success", data: [{ uid: "abc" }] };
    },
    { sms: "MyApp", whatsapp: "22998000000" }
  ).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const base = `http://127.0.0.1:${address.port}`;
  const send = (path: string, body: unknown, auth = true) =>
    fetch(base + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(auth ? { Authorization: "Bearer test-secret" } : {}),
      },
      body: JSON.stringify(body),
    });
  try {
    assert.equal((await fetch(base + "/health")).status, 200);
    assert.equal((await send("/api/sms/send", {}, false)).status, 401);
    assert.equal(
      (await send("/api/sms/send", { recipient: "invalid" })).status,
      400
    );
    assert.equal(calls.length, 0);
    assert.equal(
      (
        await send("/api/sms/send", {
          recipient: "+22997000000,22998000000",
          message: "Bonjour",
        })
      ).status,
      200
    );
    assert.deepEqual(calls[0], {
      path: "/sms/send",
      body: {
        recipient: "22997000000,22998000000",
        sender_id: "MyApp",
        message: "Bonjour",
        type: "plain",
      },
    });
    assert.equal(
      (
        await send("/api/whatsapp/send", {
          recipient: "22997000000",
          message: "Bonjour",
          media_url: "https://example.com/file.pdf",
          delay: "no",
        })
      ).status,
      200
    );
    assert.equal((calls[1].body as { type: string }).type, "whatsapp");
    assert.equal(
      (calls[1].body as { sender_id: string }).sender_id,
      "22998000000"
    );
    for (const route of ["/api/sms/send", "/api/whatsapp/send"]) {
      assert.equal(
        (
          await send(route, {
            recipient: "22997000000",
            sender_id: "Injected",
            message: "Bonjour",
          })
        ).status,
        400
      );
    }
    assert.equal(calls.length, 2);
    assert.equal(
      (
        await send("/api/sms/send", {
          recipient: "22997000000",
          message: "Bonjour",
          schedule_time: "2027-02-30 12:00",
        })
      ).status,
      400
    );
    assert.equal(
      (
        await fetch(base + "/api/whatsapp/check/22997000000", {
          headers: { Authorization: "Bearer test-secret" },
        })
      ).status,
      200
    );
    assert.equal(calls[2].path, "/check_number/22997000000");
    assert.equal(
      (
        await fetch(base + "/api/messages?page=2", {
          headers: { Authorization: "Bearer test-secret" },
        })
      ).status,
      200
    );
    assert.equal(calls[3].path, "/sms?page=2");
    assert.equal(
      (
        await fetch(base + "/api/messages/abc", {
          headers: { Authorization: "Bearer test-secret" },
        })
      ).status,
      200
    );
    assert.equal(calls[4].path, "/sms/abc");
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve()))
    );
  }
});

test("provider headers, errors and timeouts without sending real messages", async () => {
  const client = createTechsoft("fake-token", 1000, async (url, init) => {
    assert.equal(url, "https://app.techsoft-sms.com/api/v3/sms/send");
    assert.equal(
      (init?.headers as Record<string, string>).Authorization,
      "Bearer fake-token"
    );
    assert.equal(init?.method, "POST");
    return Response.json({
      status: "error",
      http_status: 403,
      message: "Insufficient balance",
    });
  });
  await assert.rejects(
    client("/sms/send", {}),
    (e: unknown) => e instanceof ProviderError && e.statusCode === 403
  );
  const timeout = createTechsoft("fake-token", 100, async () => {
    throw new DOMException("timeout", "TimeoutError");
  });
  await assert.rejects(
    timeout("/sms/send", {}),
    (e: unknown) => e instanceof ProviderError && e.statusCode === 504
  );
  const invalid = createTechsoft(
    "fake-token",
    100,
    async () => new Response("not json")
  );
  await assert.rejects(
    invalid("/sms"),
    (e: unknown) => e instanceof ProviderError && e.statusCode === 502
  );
});
