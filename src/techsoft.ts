export class ProviderError extends Error {
  constructor(public statusCode: number, public response: unknown) {
    super("Techsoft request failed");
  }
}

export function createTechsoft(
  token: string,
  timeout: number,
  fetcher: typeof fetch = fetch
) {
  return async (path: string, body?: unknown): Promise<unknown> => {
    let response: Response;
    try {
      response = await fetcher(`https://app.techsoft-sms.com/api/v3${path}`, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeout),
        redirect: "error",
      });
    } catch (error) {
      const timedOut =
        error instanceof Error &&
        ["TimeoutError", "AbortError"].includes(error.name);
      throw new ProviderError(timedOut ? 504 : 502, {
        status: "error",
        message: timedOut
          ? "Techsoft timeout; delivery status unknown."
          : "Techsoft unreachable; delivery status unknown.",
      });
    }
    let data: unknown;
    try {
      data = await response.json();
    } catch {
      throw new ProviderError(502, {
        status: "error",
        message: "Invalid Techsoft response.",
      });
    }
    if (!response.ok)
      throw new ProviderError(
        response.status >= 400 && response.status < 500 ? response.status : 502,
        data
      );
    if (
      typeof data === "object" &&
      data !== null &&
      "status" in data &&
      data.status === "error"
    ) {
      const code = "http_status" in data ? Number(data.http_status) : 502;
      throw new ProviderError(code >= 400 && code <= 599 ? code : 502, data);
    }
    return data;
  };
}
