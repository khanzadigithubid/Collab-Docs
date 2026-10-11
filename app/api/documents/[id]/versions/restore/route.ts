type RouteParams = { params: Promise<{ id: string }> };

function realtimeHttpUrl(path: string): string {
  const override = process.env.NEXT_PUBLIC_WS_URL;
  if (override) {
    return `${override.replace(/^ws/i, "http").replace(/\/$/, "")}${path}`;
  }
  const host = process.env.REALTIME_HOST || "localhost";
  const port = process.env.REALTIME_PORT || "1234";
  return `http://${host}:${port}${path}`;
}

export async function POST(request: Request, { params }: RouteParams) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const epoch = Number(body?.epoch);
  if (!Number.isFinite(epoch)) {
    return Response.json({ error: "Invalid epoch" }, { status: 400 });
  }

  try {
    const res = await fetch(
      realtimeHttpUrl(
        `/restore?doc=${encodeURIComponent(id)}&epoch=${epoch}`,
      ),
      { method: "POST", cache: "no-store" },
    );
    const data = (await res.json().catch(() => ({}))) as { status?: number };
    return Response.json(data, { status: res.ok ? 200 : (data.status ?? 502) });
  } catch {
    return Response.json(
      { ok: false, error: "Realtime server unreachable" },
      { status: 502 },
    );
  }
}