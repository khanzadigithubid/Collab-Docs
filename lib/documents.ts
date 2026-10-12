import { promises as fs } from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  Comment,
  DocumentMeta,
  DocumentVersion,
  Reaction,
} from "./types";

export type { Comment, DocumentMeta, DocumentVersion, Reaction };

const isServerless = process.env.VERCEL === "1" || process.env.VERCEL_ENV !== undefined;
// Vercel's filesystem is read-only except /tmp. On serverless the data dir is
// ephemeral (lost on cold start) — this only keeps requests from crashing.
const DATA_DIR =
  process.env.DATA_DIR ||
  (isServerless ? "/tmp/data" : path.join(process.cwd(), "data"));
const DOCS_DIR = path.join(DATA_DIR, "docs");
const META_FILE = path.join(DATA_DIR, "meta.json");
const VERSIONS_DIR = path.join(DATA_DIR, "versions");

export const documentFilePath = (id: string) =>
  path.join(DOCS_DIR, `${encodeURIComponent(id)}.bin`);

export const versionIndexPath = (id: string) =>
  path.join(VERSIONS_DIR, encodeURIComponent(id), "index.json");

async function ensureDirs() {
  await fs.mkdir(DOCS_DIR, { recursive: true });
  await fs.mkdir(VERSIONS_DIR, { recursive: true });
}

async function readMeta(): Promise<DocumentMeta[]> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(META_FILE, "utf8");
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as DocumentMeta[]) : [];
  } catch {
    return [];
  }
}

async function writeMeta(docs: DocumentMeta[]) {
  await ensureDirs();
  const tmp = `${META_FILE}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(docs, null, 2), "utf8");
  await fs.rename(tmp, META_FILE);
}

const makeId = () => randomUUID().replace(/-/g, "").slice(0, 12);

export function sanitizeTitle(input: unknown, fallback = "Untitled document") {
  const title = typeof input === "string" ? input.trim() : "";
  return (title || fallback).slice(0, 120);
}

export async function listDocuments(): Promise<DocumentMeta[]> {
  const docs = await readMeta();
  return docs.sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getDocument(id: string): Promise<DocumentMeta | null> {
  const docs = await readMeta();
  return docs.find((d) => d.id === id) ?? null;
}

export async function createDocument(titleInput: unknown): Promise<DocumentMeta> {
  const docs = await readMeta();
  const now = Date.now();
  const doc: DocumentMeta = {
    id: makeId(),
    title: sanitizeTitle(titleInput),
    createdAt: now,
    updatedAt: now,
  };
  docs.push(doc);
  await writeMeta(docs);
  return doc;
}

export async function updateDocument(
  id: string,
  titleInput: unknown,
): Promise<DocumentMeta | null> {
  const docs = await readMeta();
  const doc = docs.find((d) => d.id === id);
  if (!doc) return null;
  doc.title = sanitizeTitle(titleInput, doc.title);
  doc.updatedAt = Date.now();
  await writeMeta(docs);
  return doc;
}

export async function deleteDocument(id: string): Promise<boolean> {
  const docs = await readMeta();
  const next = docs.filter((d) => d.id !== id);
  if (next.length === docs.length) return false;
  await writeMeta(next);
  try {
    await fs.rm(documentFilePath(id), { force: true });
  } catch {
    /* ignore */
  }
  try {
    await fs.rm(path.dirname(versionIndexPath(id)), { force: true, recursive: true });
  } catch {
    /* ignore */
  }
  return true;
}

export async function setDocumentReactions(
  id: string,
  reactions: Reaction[],
): Promise<DocumentMeta | null> {
  const docs = await readMeta();
  const doc = docs.find((d) => d.id === id);
  if (!doc) return null;
  doc.reactions = reactions;
  doc.updatedAt = Date.now();
  await writeMeta(docs);
  return doc;
}

export async function updateDocumentFields(
  id: string,
  fields: {
    reactions?: Reaction[];
    comments?: Comment[];
    starred?: boolean;
    lastViewedAt?: number;
  },
): Promise<DocumentMeta | null> {
  const docs = await readMeta();
  const doc = docs.find((d) => d.id === id);
  if (!doc) return null;
  if (fields.reactions !== undefined) doc.reactions = fields.reactions;
  if (fields.comments !== undefined) doc.comments = fields.comments;
  if (fields.starred !== undefined) doc.starred = fields.starred;
  if (fields.lastViewedAt !== undefined) doc.lastViewedAt = fields.lastViewedAt;
  doc.updatedAt = Date.now();
  await writeMeta(docs);
  return doc;
}

export async function duplicateDocument(id: string): Promise<DocumentMeta | null> {
  const docs = await readMeta();
  const source = docs.find((d) => d.id === id);
  if (!source) return null;
  const now = Date.now();
  const copy: DocumentMeta = {
    id: makeId(),
    title: `${source.title} (copy)`,
    createdAt: now,
    updatedAt: now,
  };
  try {
    await fs.copyFile(documentFilePath(id), documentFilePath(copy.id));
  } catch {
    /* no content bytes yet — copy only metadata */
  }
  docs.push(copy);
  await writeMeta(docs);
  return copy;
}

export async function listVersions(id: string): Promise<DocumentVersion[]> {
  await ensureDirs();
  try {
    const raw = await fs.readFile(versionIndexPath(id), "utf8");
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as DocumentVersion[]).sort((a, b) => b.epoch - a.epoch);
  } catch {
    return [];
  }
}
