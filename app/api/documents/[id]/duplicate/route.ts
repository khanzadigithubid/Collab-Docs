import { duplicateDocument } from "@/lib/documents";

type RouteParams = { params: Promise<{ id: string }> };

export async function POST(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const document = await duplicateDocument(id);
  if (!document) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }
  return Response.json({ document }, { status: 201 });
}