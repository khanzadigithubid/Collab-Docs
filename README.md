# Collab Docs

A real-time collaborative document editor (Google Docs–style clone) built with **zero external APIs** — everything runs locally.

## Features

- Real-time collaborative editing (multiple people edit the same doc simultaneously)
- Live cursors / presence — see who is viewing the doc and where their cursor is
- Members list — online people panel with names and colors
- Rich text toolbar: bold, italic, underline, strikethrough, highlight, text color,
  alignment, headings, lists, quotes, code blocks, links, tables, images
- Emoji reactions on every document (syncs live to all open editors)
- Comments with threaded replies (syncs live, persisted to metadata)
- Room chat with server-buffered history
- Version history — automatic saved versions; restore any past version (all connected users are reset to it)
- Export — download as Markdown (.md), plain text (.txt), or print to PDF
- Read-only share links (`?view=1`) — view without edit access
- Image upload with client-side resize + image by URL
- Favorite documents (star) on the dashboard with All / Favorites / Recent filters
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
- `PATCH /api/documents/[id]` — update any of: rename (`{ title }`), reactions (`{ reactions }`),
  comments (`{ comments }`), favorite (`{ starred: true }`), open timestamp (`{ lastViewedAt }`)
- `DELETE /api/documents/[id]` — delete a document
- `POST /api/documents/[id]/duplicate` — create a copy (including content)
- `GET /api/documents/[id]/versions` — list saved versions
- `POST /api/documents/[id]/versions/restore` — restore a version `{ epoch }` (forwards to the realtime server)

## Notes

- Built with Next.js cacheComponents (`next.config.ts`), so pages use `Suspense` + `connection()` instead of `export const dynamic`.
- Documents persist across server restarts (files in `data/`). Delete a document's entry + binary file to remove it permanently.
- Not serverless-deployable (Vercel/Netlify): it needs a writable filesystem and a long-lived WebSocket server — run it on a VPS instead (see below).

## Deploying on a VPS or server

The app ships with a PM2 config (`ecosystem.config.cjs`) that runs both processes:
Next.js web app on port **3000** and the WebSocket realtime server on port **1234**.

### 1. Provision a server and install Node (Debian/Ubuntu)

```bash
sudo apt update && sudo apt install -y curl git
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs
```

### 2. Clone and build

```bash
git clone https://github.com/khanzadigithubid/Collab-Docs.git
cd Collab-Docs
npm ci
npm run build
```

### 3. Run with PM2

```bash
npm install -g pm2
pm2 start ecosystem.config.cjs
pm2 save
pm2 startup    # follow the printed command to auto-start on boot
```

This starts:

| Process | What | Port |
| --- | --- | --- |
| `collab-web` | Next.js (UI + REST API) | 3000 |
| `collab-realtime` | WebSocket sync server | 1234 |

### 4. Open ports

```bash
sudo ufw allow 3000/tcp
sudo ufw allow 1234/tcp
```

### 5. (Recommended) Reverse proxy + TLS

Point two records at the server (`collab.example.com` and `ws.collab.example.com`), then use
Caddy for automatic HTTPS. Example `Caddyfile`:

```
collab.example.com {
    reverse_proxy 127.0.0.1:3000
}
ws.collab.example.com {
    reverse_proxy 127.0.0.1:1234
}
```

Set the secure WebSocket URL used by the browser:

```bash
# in the shell that runs the build, or in ecosystem.config.cjs env
NEXT_PUBLIC_WS_URL=wss://ws.collab.example.com
```

If you skip the `ws.` subdomain, the client auto-detects `wss://<your-host>:1234` — which also
works, provided TLS is terminated on port 1234 itself.

### 6. Data directory

Documents are stored in `data/` inside the app folder (override with `DATA_DIR`). The folder is
auto-created on first run; just make sure the PM2 user can write there.

### Hosting options

Any small VPS (Hetzner, DigitalOcean, Vultr, Contabo) or a Node-friendly PaaS that supports
long-running processes (Railway, Render, Fly.io) works. Databases/queues not required.