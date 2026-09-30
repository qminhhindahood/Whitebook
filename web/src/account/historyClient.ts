import { accountFetch, csrfToken } from "./accountClient";

export class HistoryRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export async function historyRequest<T>(path: string, method = "GET", payload?: unknown): Promise<T> {
  const response = await accountFetch(path, method === "GET" ? undefined : {
    method, headers: { "X-CSRF-Token": csrfToken(), ...(payload === undefined ? {} : { "Content-Type": "application/json" }) },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
  if (!response.ok) {
    const data = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new HistoryRequestError(`${data?.error?.message ?? "History could not complete this request. Try again."} (HTTP ${response.status})`, response.status);
  }
  return response.status === 204 ? undefined as T : response.json() as Promise<T>;
}
