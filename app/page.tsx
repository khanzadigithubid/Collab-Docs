import { Suspense } from "react";
import { connection } from "next/server";
import Dashboard from "@/components/Dashboard";
import { listDocuments } from "@/lib/documents";

async function DocumentsSection() {
  await connection();
  const documents = await listDocuments();
  return <Dashboard initialDocuments={documents} />;
}

function HomeSkeleton() {
  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="h-8 w-48 animate-pulse rounded bg-zinc-200 dark:bg-zinc-800" />
      <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div
            key={i}
            className="h-28 animate-pulse rounded-xl bg-zinc-100 dark:bg-zinc-900"
          />
        ))}
      </div>
    </div>
  );
}

export default function HomePage() {
  return (
    <Suspense fallback={<HomeSkeleton />}>
      <DocumentsSection />
    </Suspense>
  );
}
