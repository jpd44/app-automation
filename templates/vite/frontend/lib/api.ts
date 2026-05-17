import { getIdToken } from "./auth";

const API_URL = import.meta.env.VITE_API_URL;

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = "ApiError";
  }
}

export async function apiFetch<T = unknown>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const token = await getIdToken();
  if (!token) throw new ApiError(401, "Not signed in");

  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      ...(init.headers ?? {}),
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new ApiError(res.status, text || res.statusText);
  }

  return res.json() as Promise<T>;
}
