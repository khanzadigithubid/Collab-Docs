export function getRealtimeUrl(): string {
  const configured = process.env.NEXT_PUBLIC_WS_URL;
  if (configured) return configured;
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    return `${protocol}//${window.location.hostname}:1234`;
  }
  return "ws://localhost:1234";
}

const PALETTE = [
  "#6366f1",
  "#ec4899",
  "#f59e0b",
  "#10b981",
  "#06b6d4",
  "#8b5cf6",
  "#ef4444",
  "#84cc16",
];

export type CollabUser = { name: string; color: string; clientId?: number };

const NAME_KEY = "collab-name";

export function getLocalUserName(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(NAME_KEY) ?? "";
  } catch {
    return "";
  }
}

export function setLocalUserName(name: string) {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

export function createLocalUser(): CollabUser {
  const stored = getLocalUserName().trim();
  const name =
    stored ||
    `Guest ${Math.floor(1000 + Math.random() * 9000)}`;
  const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
  return { name, color };
}
