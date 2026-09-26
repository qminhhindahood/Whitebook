export function csrfToken(): string {
  const match = /(?:^|;\s*)__Host-wb_csrf=([a-f0-9]{64})(?:;|$)/.exec(document.cookie);
  return match?.[1] ?? "";
}

export async function accountFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(path, { credentials: "same-origin", cache: "no-store", ...init });
}
