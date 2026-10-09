// Authenticated fetch helper for the private `/api/user/...` Cloud Run routes.
//
// Attaches the current Firebase user's ID token as a Bearer header. The
// Cloud Run API verifies the token and derives the user id server-side —
// callers never need to pass a `userId`.

import { auth } from "./firebase";

const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/$/, "") || "";

function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

/** Fetch a private `/api/user/...` endpoint with a Firebase Bearer token attached. */
export async function authFetch(path: string, init: RequestInit = {}): Promise<Response> {
  if (!auth?.currentUser) {
    throw new ApiError(401, "Not signed in");
  }
  const token = await auth.currentUser.getIdToken();

  const headers = new Headers(init.headers);
  headers.set("Authorization", `Bearer ${token}`);
  if (init.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  let res: Response;
  try {
    res = await fetch(apiUrl(path), { ...init, headers });
  } catch {
    throw new Error(
      import.meta.env.DEV
        ? "Failed to reach the local API. Keep `npm run dev` (port 8000) running alongside the web app."
        : "Failed to reach the API. Check VITE_API_URL."
    );
  }

  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new ApiError(res.status, detail.detail || res.statusText);
  }
  return res;
}

/** Convenience wrapper that also parses the JSON body. */
export async function authJson<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await authFetch(path, init);
  return res.json() as Promise<T>;
}
