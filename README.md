# Collab Docs

A real-time collaborative document editor (Google Docs–style clone) built with **zero external APIs** — everything runs locally.

## Features

- Real-time collaborative editing (multiple people edit the same doc simultaneously)
- Live cursors / presence — see who is viewing the doc and where their cursor is
- Members list — online people panel with names and colors
- Rich text toolbar: bold, italic, underline, strikethrough, highlight, text color,
  alignment, headings, lists, quotes, code blocks, links, tables, images
- Emoji reactions on every document (syncs live to all open editors)
- Version history — automatic saved versions; restore any past version (all connected users are reset to it)
- Export — download as Markdown (.md), plain text (.txt), or print to PDF
- Duplicate any document with one click
- Dark mode toggle (persisted per browser)
- Auto-save: docs persist to disk as files, reloaded when the server restarts
- Document dashboard: create, search, join by link, rename, delete
- No external services or paid APIs required

## Tech Stack

- [Next.js 16](https://nextjs.org) (App Router) + React 19 + TypeScript
- [TipTap 3](https://tiptap.dev) editor with collaboration extensions
- [Yjs](https://yjs.dev) CRDT + [y-websocket](https://github.com/yjs/y-websocket) for real-time sync
- Custom WebSocket server (`realtime/server.mjs`) using `ws` + `y-protocols`
- Tailwind CSS v4

## Architecture

| Part | Where | Port |
| --- | --- | --- |
| Next.js app (UI + REST API) | App Router routes + `app/api` | 3000 |
| WebSocket server (Yjs sync) | `realtime/server.mjs` | 1234 |

- The Next.js app owns document metadata and the REST API (`app/api/documents`).
- The WebSocket server handles live CRDT sync, awareness (presence), room-level custom
  messages (reactions), version snapshots, and restore via its HTTP endpoint
  (`POST /restore?doc=<id>&epoch=<epoch>`).
- Documents are persisted to the local filesystem: `data/docs/<id>.bin` (document state),
  `data/versions/<id>/` (version snapshots + index), and `data/meta.json` (metadata).
  `data/` is gitignored.
- The realtime URL is auto-detected (`ws://<host>:1234`, or `wss://` on HTTPS) and can be
  overridden with the `NEXT_PUBLIC_WS_URL` environment variable.
- Version snapshots are kept up to the 15 most recent, at most every 10 seconds of editing
  (`REALTIME_VERSION_INTERVAL` env var can tune the interval).

## Getting Started

### Prerequisites

- Node.js 20+
- npm

### Install

```bash
npm install
```

### Run (app + realtime server together)

```bash
npm run dev
```

- Open http://localhost:3000
- Create a new document
- Open the same document link in another tab/browser to see live sync

Alternatively run the two parts separately:

```bash
npm run dev:app     # Next.js only
npm run realtime    # WebSocket server only
```

### Production build

```bash
npm run build
npm run start
```

### Lint

```bash
npm run lint
```

## API

- `GET /api/documents` — list documents
- `POST /api/documents` — create a document
- `GET /api/documents/[id]` — get a document
- `PATCH /api/documents/[id]` — rename a document and/or update reactions (`{ title?, reactions? }`)
- `DELETE /api/documents/[id]` — delete a document
- `POST /api/documents/[id]/duplicate` — create a copy (including content)
- `GET /api/documents/[id]/versions` — list saved versions
- `POST /api/documents/[id]/versions/restore` — restore a version `{ epoch }` (forwards to the realtime server)

## Notes

- Built with Next.js cacheComponents (`next.config.ts`), so pages use `Suspense` + `connection()` instead of `export const dynamic`.
- Documents persist across server restarts (files in `data/`). Delete a document's entry + binary file to remove it permanently.