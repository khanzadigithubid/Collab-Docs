import {
  deleteDocument,
  getDocument,
  updateDocument,
  updateDocumentFields,
} from "@/lib/documents";
import type { Comment, Reaction } from "@/lib/types";

type RouteParams = { params: Promise<{ id: string }> };

function isReactionArray(v: unknown): v is Reaction[] {
  return (
    Array.isArray(v) &&
    v.every(
      (r) =>
        typeof r === "object" &&
        r !== null &&
        typeof (r as Reaction).emoji === "string" &&
        typeof (r as Reaction).count === "number",
    )
  );
}

function isCommentArray(v: unknown): v is Comment[] {
  return (
    Array.isArray(v) &&
    v.every(
      (c) =>
        typeof c === "object" &&
        c !== null &&
        typeof (c as Comment).text === "string",
    )
  );
}

export async function GET(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const document = await getDocument(id);
  if (!document) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }
  return Response.json({ document });
}

export async function PATCH(request: Request, { params }: RouteParams) {
  const { id } = await params;
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  let document = null;

  if (typeof body.title === "string") {
    document = await updateDocument(id, body.title);
    if (!document) {
      return Response.json({ error: "Document not found" }, { status: 404 });
    }
  }

  const hasField =
    body.reactions !== undefined ||
    body.comments !== undefined ||
    body.starred !== undefined ||
    body.lastViewedAt !== undefined;

  if (hasField) {
    const fields: Parameters<typeof updateDocumentFields>[1] = {};
    if (isReactionArray(body.reactions)) fields.reactions = body.reactions;
    if (isCommentArray(body.comments)) fields.comments = body.comments;
    if (typeof body.starred === "boolean") fields.starred = body.starred;
    if (typeof body.lastViewedAt === "number")
      fields.lastViewedAt = body.lastViewedAt;

    if (Object.keys(fields).length > 0) {
      document = await updateDocumentFields(id, fields);
      if (!document) {
        return Response.json({ error: "Document not found" }, { status: 404 });
      }
    }
  }

  if (!document) {
    return Response.json({ error: "Nothing to update" }, { status: 400 });
  }

  return Response.json({ document });
}

export async function DELETE(_request: Request, { params }: RouteParams) {
  const { id } = await params;
  const removed = await deleteDocument(id);
  if (!removed) {
    return Response.json({ error: "Document not found" }, { status: 404 });
  }
  return Response.json({ ok: true });
}
