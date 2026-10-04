export async function bankGet<T>(path: string): Promise<T> {
  const response = await fetch(path, { credentials: "same-origin", cache: "no-store" });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: { message?: string } } | null;
    throw new Error(response.status === 401 ? "Your session ended. Sign in again." : body?.error?.message ?? "The Question Bank could not be loaded. Try again.");
  }
  return response.json() as Promise<T>;
}


