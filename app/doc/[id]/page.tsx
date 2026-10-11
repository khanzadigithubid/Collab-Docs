import { Suspense } from "react";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import Link from "next/link";
import Editor from "@/components/Editor";
import { getDocument } from "@/lib/documents";

export const instant = false;

async function DocumentSection({
  id,
  readOnly,
}: {
  id: string;
  readOnly: boolean;
}) {
  await connection();
  const document = await getDocument(id);

  if (!document) {
    notFound();
  }

  return (
    <Editor
      docId={document.id}
      initialTitle={document.title}
      initialReactions={document.reactions ?? []}
      initialComments={document.comments ?? []}
      initialReadOnly={readOnly}
    />
  );
}

export default async function DocumentPage({
  params,
  searchParams,
}: PageProps<"/doc/[id]">) {
  const { id } = await params;
  const sp = await searchParams;
  const readOnly = sp.view === "1";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <nav className="border-b border-zinc-200 px-4 py-2 text-sm dark:border-zinc-800">
        <Link
          href="/"
          className="text-zinc-500 transition hover:text-zinc-800 dark:hover:text-zinc-200"
        >
          ← All documents
        </Link>
      </nav>
      <Suspense
        fallback={
          <p className="px-6 py-6 text-sm text-zinc-400">Loading document...</p>
        }
      >
        <DocumentSection id={id} readOnly={readOnly} />
      </Suspense>
    </div>
  );
}
