import { createDocument, listDocuments } from "@/lib/documents";

export async function GET() {
  const documents = await listDocuments();
  return Response.json({ documents });
}

export async function POST(request: Request) {
  let title: unknown = undefined;
  try {
    const body = await request.json();
    title = body?.title;
  } catch {
    title = undefined;
  }
  const document = await createDocument(title);
  return Response.json({ document }, { status: 201 });
}
