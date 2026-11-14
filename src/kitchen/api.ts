export class ApiError extends Error {
  status: number;
  details: any;
  constructor(message: string, status: number, details?: any) {
    super(message);
    this.status = status;
    this.details = details;
  }
}
export async function api<T = any>(
  path: string,
  method = "GET",
  body?: unknown,
  key?: string,
  signal?: AbortSignal,
): Promise<T> {
  const controller = method === "GET" ? new AbortController() : null;
  let timedOut = false;
  const cancel = () => controller?.abort();
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, { once: true });
  // Include response-body reads in the deadline, including through a service worker.
  const timeout = controller
    ? window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, 25_000)
    : undefined;
  try {
    const response = await fetch("/api" + path, {
      method,
      credentials: "same-origin",
      signal: controller?.signal ?? signal,
      headers: {
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
        ...(key ? { "Idempotency-Key": key } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!response.ok) {
      const data = await response
        .json()
        .catch(() => ({ error: "השרת אינו זמין כרגע" }));
      if (response.status === 401)
        window.dispatchEvent(new Event("kitchen-signed-out"));
      throw new ApiError(
        data.error || "הפעולה נכשלה",
        response.status,
        data.details,
      );
    }
    const result = await response.json();
    if (
      method !== "GET" &&
      ((/^\/recipes(?:\/|$)/.test(path) && !path.endsWith("/favorite")) ||
        path.startsWith("/recipe-collection/"))
    )
      window.dispatchEvent(new Event("kitchen-recipes-changed"));
    return result;
  } catch (error) {
    if (timedOut && !signal?.aborted)
      throw new ApiError("הטעינה התעכבה. אפשר לנסות שוב.", 408);
    throw error;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
}
export async function upload(file: File, path = "/media") {
  const form = new FormData();
  form.append("file", file);
  const r = await fetch("/api" + path, {
    method: "POST",
    credentials: "same-origin",
    body: form,
  });
  const data = await r.json();
  if (!r.ok) throw new ApiError(data.error || "ההעלאה נכשלה", r.status);
  return data;
}
export const mediaUrl = (id: string, variant = "thumbnail") =>
  `/api/media/${id}/content?variant=${variant}`;
export function go(path: string) {
  window.location.hash = path;
}
