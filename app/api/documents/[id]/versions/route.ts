import { listVersions } from "@/lib/documents";

type RouteParams = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const versions = await listVersions(id);
  return Response.json({ versions });
}