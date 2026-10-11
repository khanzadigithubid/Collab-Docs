"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import type { DocumentMeta } from "@/lib/types";
import ThemeToggle from "./ThemeToggle";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return new Date(ts).toLocaleDateString("en-US");
}

export default function Dashboard({
  initialDocuments,
}: {
  initialDocuments: DocumentMeta[];
}) {
  const router = useRouter();
  const [documents, setDocuments] = useState(initialDocuments);
  const [query, setQuery] = useState("");
  const [view, setView] = useState<"all" | "starred" | "recent">("all");
  const [creating, setCreating] = useState(false);
  const [joinId, setJoinId] = useState("");
  const [error, setError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    let list = documents;
    if (view === "starred") {
      list = list.filter((d) => d.starred);
    } else if (view === "recent") {
      list = [...list].sort(
        (a, b) =>
          (b.lastViewedAt ?? b.updatedAt) - (a.lastViewedAt ?? a.updatedAt),
      );
    }
    const q = query.trim().toLowerCase();
    if (q) list = list.filter((d) => d.title.toLowerCase().includes(q));
    return list;
  }, [documents, view, query]);

  async function createDocument() {
    setCreating(true);
    setError(null);
    try {
      const res = await fetch("/api/documents", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: "Untitled document" }),
      });
      if (!res.ok) throw new Error("Could not create document");
      const data = await res.json();
      router.push(`/doc/${data.document.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setCreating(false);
    }
  }

  async function removeDocument(id: string) {
    setDocuments((prev) => prev.filter((d) => d.id !== id));
    try {
      await fetch(`/api/documents/${id}`, { method: "DELETE" });
    } catch {
      setError("Failed to delete document");
    }
  }

  async function duplicateDocument(id: string) {
    setError(null);
    try {
      const res = await fetch(`/api/documents/${id}/duplicate`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Could not duplicate");
      const data = await res.json();
      setDocuments((prev) => [data.document, ...prev]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to duplicate");
    }
  }

  async function toggleStar(doc: DocumentMeta) {
    const next = !doc.starred;
    setDocuments((prev) =>
      prev.map((d) => (d.id === doc.id ? { ...d, starred: next } : d)),
    );
    try {
      const res = await fetch(`/api/documents/${doc.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ starred: next }),
      });
      if (!res.ok) throw new Error("Failed");
    } catch {
      setError("Failed to update favorite");
    }
  }

  function join() {
    const id = joinId.trim().split("/").filter(Boolean).pop();
    if (!id) return;
    router.push(`/doc/${id}`);
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Collab Docs</h1>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Real-time collaborative documents. Open a link and edit together.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <ThemeToggle />
          <button
            onClick={createDocument}
            disabled={creating}
            className="rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-60"
          >
            {creating ? "Creating..." : "+ New document"}
          </button>
        </div>
      </header>

      <div className="mt-8 flex flex-wrap gap-3">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search documents..."
          className="min-w-[220px] flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
        />
        <div className="flex flex-1 gap-2">
          <input
            value={joinId}
            onChange={(e) => setJoinId(e.target.value)}
            placeholder="Paste a document link or ID"
            className="flex-1 rounded-lg border border-zinc-300 bg-transparent px-3 py-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
          />
          <button
            onClick={join}
            className="rounded-lg border border-zinc-300 px-4 py-2 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            Join
          </button>
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        {(
          [
            ["all", "All"],
            ["starred", "★ Favorites"],
            ["recent", "Recent"],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`rounded-full border px-3 py-1.5 text-sm font-medium transition ${
              view === key
                ? "border-indigo-500 bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
                : "border-zinc-300 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {error && (
        <p className="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}

      <section className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((doc) => (
          <div
            key={doc.id}
            className="group relative flex flex-col justify-between rounded-xl border border-zinc-200 p-4 transition hover:border-indigo-400 hover:shadow-sm dark:border-zinc-800"
          >
            <button
              onClick={() => router.push(`/doc/${doc.id}`)}
              className="text-left"
            >
              <h2 className="line-clamp-2 pr-5 font-medium">{doc.title}</h2>
              <p className="mt-1 text-xs text-zinc-500" suppressHydrationWarning>
                Updated {timeAgo(doc.updatedAt)}
              </p>
            </button>
            <button
              onClick={() => toggleStar(doc)}
              title={doc.starred ? "Remove from favorites" : "Add to favorites"}
              className={`absolute right-2 top-2 text-lg leading-none transition ${
                doc.starred
                  ? "text-amber-500"
                  : "text-zinc-300 hover:text-amber-400 dark:text-zinc-600"
              }`}
            >
              ★
            </button>
            <div className="mt-4 flex items-center justify-between gap-2">
              <span className="font-mono text-[11px] text-zinc-400">
                {doc.id}
              </span>
              <div className="flex items-center gap-2 opacity-0 transition group-hover:opacity-100">
                <button
                  onClick={() => duplicateDocument(doc.id)}
                  className="text-xs text-zinc-400 transition hover:text-indigo-500"
                  title="Duplicate document"
                >
                  Copy
                </button>
                <button
                  onClick={() => removeDocument(doc.id)}
                  className="text-xs text-zinc-400 transition hover:text-red-500"
                  title="Delete document"
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}

        {filtered.length === 0 && (
          <div className="col-span-full rounded-xl border border-dashed border-zinc-300 p-10 text-center text-sm text-zinc-500 dark:border-zinc-700">
            {documents.length === 0
              ? "No documents yet. Create your first one."
              : view === "starred"
                ? "No favorites yet. Star a document to pin it here."
                : "No documents match your search."}
          </div>
        )}
      </section>
    </div>
  );
}
