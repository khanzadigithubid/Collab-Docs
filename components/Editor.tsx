"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import * as encoding from "lib0/encoding";
import * as decoding from "lib0/decoding";
import CollaborativeEditor from "./CollaborativeEditor";
import ThemeToggle from "./ThemeToggle";
import { download, htmlToMarkdown } from "@/lib/export";
import {
  createLocalUser,
  getRealtimeUrl,
  getLocalUserName,
  setLocalUserName,
  type CollabUser,
} from "@/lib/presence";
import type {
  ChatMessage,
  Comment,
  DocumentVersion,
  Reaction,
} from "@/lib/types";
import type { Editor as TiptapEditor } from "@tiptap/react";

type ConnectionStatus = "connecting" | "connected" | "disconnected";

const messageReset = 4;
const messageCustom = 6;
const REACTION_EMOJIS = ["👍", "❤️", "😄", "🎉", "👀"];

function formatTime(ts: number): string {
  const d = new Date(ts);
  return `${d.toLocaleDateString("en-US")} ${d.toLocaleTimeString("en-US", {
    hour: "2-digit",
    minute: "2-digit",
  })}`;
}

function drawerClasses(open: boolean) {
  return `fixed inset-y-0 right-0 z-30 flex w-80 max-w-[85vw] flex-col border-l border-zinc-200 bg-white shadow-xl transition-transform dark:border-zinc-800 dark:bg-zinc-900 ${
    open ? "translate-x-0" : "translate-x-full"
  }`;
}

function Drawer({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <>
      {open && (
        <div className="fixed inset-0 z-20 bg-black/20" onClick={onClose} />
      )}
      <aside className={drawerClasses(open)} aria-hidden={!open}>
        <header className="flex items-center justify-between border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
          <h2 className="font-medium">{title}</h2>
          <button
            onClick={onClose}
            className="rounded-md px-2 py-1 text-zinc-400 transition hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
            title="Close"
          >
            ✕
          </button>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto">{children}</div>
      </aside>
    </>
  );
}

function Session({
  docId,
  initialTitle,
  initialReactions,
  initialComments,
  initialReadOnly,
  onReset,
}: {
  docId: string;
  initialTitle: string;
  initialReactions: Reaction[];
  initialComments: Comment[];
  initialReadOnly: boolean;
  onReset: () => void;
}) {
  const [ydoc] = useState(() => new Y.Doc());
  const [provider, setProvider] = useState<WebsocketProvider | null>(null);
  const [status, setStatus] = useState<ConnectionStatus>("connecting");
  const [synced, setSynced] = useState(false);
  const [peers, setPeers] = useState<CollabUser[]>([]);
  const [title, setTitle] = useState(initialTitle);
  const [savedTitle, setSavedTitle] = useState(initialTitle);
  const [copied, setCopied] = useState(false);
  const [reactions, setReactions] = useState<Reaction[]>(initialReactions);
  const [comments, setComments] = useState<Comment[]>(initialComments);
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [myReactions, setMyReactions] = useState<Set<string>>(new Set());
  const [showPeople, setShowPeople] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showComments, setShowComments] = useState(false);
  const [showChat, setShowChat] = useState(false);
  const [readOnly, setReadOnly] = useState(initialReadOnly);
  const [versions, setVersions] = useState<DocumentVersion[]>([]);
  const [busy, setBusy] = useState(false);
  const [versionMsg, setVersionMsg] = useState<string | null>(null);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [commentDraft, setCommentDraft] = useState("");
  const [replyDrafts, setReplyDrafts] = useState<Record<string, string>>({});
  const [chatDraft, setChatDraft] = useState("");
  const [localUser, setLocalUser] = useState<CollabUser>(() =>
    createLocalUser(),
  );
  const editorRef = useRef<TiptapEditor | null>(null);
  const reactionsRef = useRef<Set<string>>(new Set());
  const chatRef = useRef<HTMLDivElement | null>(null);

  // Refresh metadata (comments/reactions) and mark the doc as viewed
  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`/api/documents/${docId}`);
        if (res.ok) {
          const data = (await res.json()) as {
            document?: { comments?: Comment[]; reactions?: Reaction[] };
          };
          if (data.document?.comments)
            setComments(data.document.comments);
          if (data.document?.reactions) setReactions(data.document.reactions);
        }
      } catch {
        /* ignore */
      }
      try {
        await fetch(`/api/documents/${docId}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ lastViewedAt: Date.now() }),
        });
      } catch {
        /* ignore */
      }
    })();
  }, [docId]);

  useEffect(() => {
    const wsProvider = new WebsocketProvider(getRealtimeUrl(), docId, ydoc, {
      connect: true,
    });
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProvider(wsProvider);

    const onStatus = (event: { status: ConnectionStatus }) => {
      setStatus(event.status);
    };
    const onSync = (isSynced: boolean) => setSynced(isSynced);
    const onAwareness = () => {
      const states = wsProvider.awareness.getStates();
      const users: CollabUser[] = [];
      states.forEach((state) => {
        const user = (state as { user?: CollabUser }).user;
        if (user) users.push(user);
      });
      setPeers(users);
    };
    const onResetMessage = (_enc: unknown, decoder: decoding.Decoder) => {
      decoding.readVarUint8Array(decoder);
      onReset();
    };
    const onCustomMessage = (_enc: unknown, decoder: decoding.Decoder) => {
      try {
        const raw = decoding.readVarUint8Array(decoder);
        const payload = JSON.parse(new TextDecoder().decode(raw)) as {
          kind?: string;
          reactions?: Reaction[];
          comments?: Comment[];
          message?: ChatMessage;
          history?: ChatMessage[];
        };
        if (payload.kind === "reactions" && Array.isArray(payload.reactions)) {
          setReactions(payload.reactions);
        }
        if (payload.kind === "comments" && Array.isArray(payload.comments)) {
          setComments(payload.comments);
        }
        if (payload.kind === "chat" && Array.isArray(payload.history)) {
          setChat(payload.history);
        }
        if (payload.kind === "chat" && payload.message) {
          setChat((prev) => [...prev.slice(-199), payload.message as ChatMessage]);
        }
      } catch {
        /* ignore malformed custom messages */
      }
    };

    wsProvider.messageHandlers[messageReset] = onResetMessage;
    wsProvider.messageHandlers[messageCustom] = onCustomMessage;
    wsProvider.on("status", onStatus);
    wsProvider.on("sync", onSync);
    wsProvider.awareness.on("change", onAwareness);

    return () => {
      delete wsProvider.messageHandlers[messageReset];
      delete wsProvider.messageHandlers[messageCustom];
      wsProvider.awareness.off("change", onAwareness);
      wsProvider.off("status", onStatus);
      wsProvider.off("sync", onSync);
      wsProvider.destroy();
      ydoc.destroy();
    };
  }, [docId, ydoc, onReset]);

  // Keep awareness user in sync when the local user renames
  useEffect(() => {
    provider?.awareness.setLocalStateField("user", localUser);
  }, [provider, localUser]);

  useEffect(() => {
    const timer = setInterval(() => {
      const editor = editorRef.current;
      if (!editor) return;
      const text = editor.state.doc.textContent;
      const words = text.trim() ? text.trim().split(/\s+/).length : 0;
      setCounts({ words, chars: text.length });
    }, 800);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (showChat) {
      chatRef.current?.scrollTo(0, chatRef.current.scrollHeight);
    }
  }, [chat, showChat]);

  async function saveTitle() {
    const next = title.trim() || "Untitled document";
    if (next === savedTitle) return;
    setSavedTitle(next);
    try {
      await fetch(`/api/documents/${docId}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: next }),
      });
    } catch {
      /* keep optimistic value */
    }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }

  function sendCustom(kind: string, data: Record<string, unknown>) {
    if (provider?.ws?.readyState !== 1) return;
    const payload = new TextEncoder().encode(JSON.stringify({ kind, ...data }));
    const encoder = encoding.createEncoder();
    encoding.writeVarUint(encoder, messageCustom);
    encoding.writeVarUint8Array(encoder, payload);
    try {
      provider.ws.send(encoding.toUint8Array(encoder));
    } catch {
      /* ignore */
    }
  }

  function persistCustom(kind: string, data: unknown) {
    return fetch(`/api/documents/${docId}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ [kind]: data }),
    });
  }

  async function toggleReaction(emoji: string) {
    const mine = new Set(reactionsRef.current);
    const reacted = mine.has(emoji);
    const next = [...reactions];
    const idx = next.findIndex((r) => r.emoji === emoji);
    if (reacted) {
      mine.delete(emoji);
      if (idx >= 0) {
        const updated = { ...next[idx], count: next[idx].count - 1 };
        if (updated.count <= 0) next.splice(idx, 1);
        else next[idx] = updated;
      }
    } else {
      mine.add(emoji);
      if (idx >= 0) next[idx] = { ...next[idx], count: next[idx].count + 1 };
      else next.push({ emoji, count: 1 });
    }
    reactionsRef.current = mine;
    setMyReactions(mine);
    setReactions(next);
    persistCustom("reactions", next);
    sendCustom("reactions", { reactions: next });
  }

  function countFor(emoji: string): number {
    return reactions.find((r) => r.emoji === emoji)?.count ?? 0;
  }

  function addComment() {
    const text = commentDraft.trim();
    if (!text) return;
    const editor = editorRef.current;
    let selection = "";
    if (editor) {
      const { from, to } = editor.state.selection;
      if (from !== to) selection = editor.state.doc.textBetween(from, to, " ");
    }
    const comment: Comment = {
      id: `c-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      authorName: localUser.name,
      authorColor: localUser.color,
      text,
      selection: selection.trim() || undefined,
      createdAt: Date.now(),
      replies: [],
    };
    const next = [comment, ...comments];
    setComments(next);
    setCommentDraft("");
    persistCustom("comments", next);
    sendCustom("comments", { comments: next });
  }

  function replyTo(commentId: string) {
    const text = (replyDrafts[commentId] ?? "").trim();
    if (!text) return;
    const next = comments.map((c) =>
      c.id === commentId
        ? {
            ...c,
            replies: [
              ...c.replies,
              {
                id: `r-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
                authorName: localUser.name,
                authorColor: localUser.color,
                text,
                createdAt: Date.now(),
              },
            ],
          }
        : c,
    );
    setComments(next);
    setReplyDrafts((d) => ({ ...d, [commentId]: "" }));
    persistCustom("comments", next);
    sendCustom("comments", { comments: next });
  }

  function deleteComment(commentId: string) {
    const next = comments.filter((c) => c.id !== commentId);
    setComments(next);
    persistCustom("comments", next);
    sendCustom("comments", { comments: next });
  }

  function sendChat() {
    const text = chatDraft.trim();
    if (!text) return;
    const message: ChatMessage = {
      id: `m-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      authorName: localUser.name,
      authorColor: localUser.color,
      text,
      createdAt: Date.now(),
    };
    setChat((prev) => [...prev, message]);
    setChatDraft("");
    sendCustom("chat", { message });
  }

  function renameSelf(name: string) {
    const clean = name.trim();
    if (!clean) return;
    setLocalUserName(clean);
    setLocalUser({ name: clean, color: localUser.color });
  }

  function toggleReadOnly() {
    const next = !readOnly;
    setReadOnly(next);
    const url = new URL(window.location.href);
    if (next) url.searchParams.set("view", "1");
    else url.searchParams.delete("view");
    window.history.replaceState({}, "", url.toString());
  }

  async function openHistory() {
    setShowHistory((v) => !v);
    if (!versions.length) {
      try {
        const res = await fetch(`/api/documents/${docId}/versions`);
        if (res.ok) {
          const data = await res.json();
          setVersions(data.versions ?? []);
        }
      } catch {
        /* ignore */
      }
    }
  }

  async function restoreVersion(epoch: number) {
    setBusy(true);
    setVersionMsg(null);
    try {
      const res = await fetch(`/api/documents/${docId}/versions/restore`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ epoch }),
      });
      if (!res.ok) throw new Error("Restore failed");
      setVersionMsg("Restored! Reconnecting...");
      setTimeout(() => {
        const el = editorRef.current;
        if (!el?.getHTML()) window.location.reload();
      }, 900);
    } catch {
      setVersionMsg("Could not restore that version.");
    } finally {
      setBusy(false);
      setShowHistory(false);
    }
  }

  function exportMarkdown() {
    const html = editorRef.current?.getHTML();
    if (!html) return;
    download(`${title}.md`, htmlToMarkdown(html), "text/markdown");
  }

  function exportText() {
    const text = editorRef.current?.getText();
    if (text == null) return;
    download(`${title}.txt`, text, "text/plain");
  }

  const statusColor =
    status === "connected"
      ? "bg-emerald-500"
      : status === "connecting"
        ? "bg-amber-500"
        : "bg-red-500";

  const saveLabel =
    status === "connected" ? (synced ? "Saved" : "Saving…") : "Offline";

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-white dark:bg-zinc-950">
      <header className="no-print relative flex flex-wrap items-center gap-3 border-b border-zinc-200 px-4 py-3 dark:border-zinc-800">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={saveTitle}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.currentTarget.blur();
            }
          }}
          disabled={readOnly}
          className="min-w-[160px] flex-1 rounded-md bg-transparent px-2 py-1 text-lg font-semibold outline-none hover:bg-zinc-100 focus:bg-zinc-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-zinc-900 dark:focus:bg-zinc-900"
          aria-label="Document title"
        />

        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowComments((v) => !v)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Comments"
          >
            💬 Comments{comments.length > 0 ? ` (${comments.length})` : ""}
          </button>
          <button
            onClick={() => setShowChat((v) => !v)}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Chat with collaborators"
          >
            Chat
          </button>
          <button
            onClick={openHistory}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Version history"
          >
            History
          </button>
          <div className="flex -space-x-2">
            {peers.slice(0, 6).map((peer, i) => (
              <span
                key={`${peer.name}-${i}`}
                title={peer.name}
                className="flex h-7 w-7 items-center justify-center rounded-full border-2 border-white text-[11px] font-medium text-white dark:border-zinc-950"
                style={{ backgroundColor: peer.color }}
              >
                {peer.name.replace("Guest ", "").slice(0, 3)}
              </span>
            ))}
          </div>
          <span className="flex items-center gap-1.5 rounded-full border border-zinc-200 px-2.5 py-1 text-xs text-zinc-500 dark:border-zinc-800">
            <span className={`h-2 w-2 rounded-full ${statusColor}`} />
            {status === "connected" ? "Live" : status}
          </span>
          <ThemeToggle />
          <button
            onClick={copyLink}
            className="rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
          >
            {copied ? "Copied!" : "Share"}
          </button>
        </div>

        <div className="hidden md:flex items-center gap-1">
          {REACTION_EMOJIS.map((emoji) => {
            const count = countFor(emoji);
            const active = myReactions.has(emoji);
            return (
              <button
                key={emoji}
                onClick={() => toggleReaction(emoji)}
                title={`React ${emoji}`}
                className={`flex items-center gap-1 rounded-full border px-2.5 py-1 text-sm transition ${
                  active
                    ? "border-indigo-400 bg-indigo-50 dark:border-indigo-600 dark:bg-indigo-950"
                    : "border-zinc-200 hover:bg-zinc-100 dark:border-zinc-800 dark:hover:bg-zinc-800"
                }`}
              >
                <span>{emoji}</span>
                {count > 0 && (
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {count}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </header>

      <div className="flex min-h-0 flex-1 justify-center overflow-hidden">
        <div className="relative flex min-h-0 w-full max-w-3xl flex-col">
          {provider && (
            <CollaborativeEditor
              ydoc={ydoc}
              provider={provider}
              user={localUser}
              editable={!readOnly}
              editorRef={editorRef}
            />
          )}
          {!provider && (
            <p className="px-6 py-6 text-sm text-zinc-400">
              Connecting to collaboration server...
            </p>
          )}
        </div>
      </div>

      <footer className="no-print flex flex-wrap items-center justify-between gap-2 border-t border-zinc-200 px-4 py-1.5 text-xs text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
        <div className="flex items-center gap-4">
          <span>{counts.words.toLocaleString()} words</span>
          <span>{counts.chars.toLocaleString()} characters</span>
          {readOnly && (
            <span className="rounded-full bg-zinc-100 px-2 py-0.5 font-medium text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
              Read-only
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleReadOnly}
            className="flex items-center gap-1.5 rounded border border-zinc-300 px-2 py-0.5 font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
            title="Toggle edit permissions for this session"
          >
            {readOnly ? "✦" : "✎"}
            {readOnly ? "Editing off" : "Editing on"}
          </button>
          <span className="flex items-center gap-1.5">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === "connected" ? "bg-emerald-500" : "bg-zinc-400"
              }`}
            />
            {saveLabel}
          </span>
        </div>
      </footer>

      <div className="relative">
        <button
          onClick={() => setShowPeople((v) => !v)}
          className="no-print absolute right-4 top-2 z-40 rounded-lg border border-zinc-300 px-3 py-1.5 text-sm font-medium transition hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-800"
        >
          People ({peers.length})
        </button>
        {showPeople && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowPeople(false)}
            />
            <div className="fixed right-4 z-50 mt-1 w-72 rounded-lg border border-zinc-200 bg-white py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
              <div className="flex items-center gap-2 border-b border-zinc-200 px-4 py-2 dark:border-zinc-800">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] text-white"
                  style={{ backgroundColor: localUser.color }}
                >
                  {localUser.name.replace("Guest ", "").slice(0, 3)}
                </span>
                <input
                  defaultValue={getLocalUserName() || localUser.name}
                  onBlur={(e) => renameSelf(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                  }}
                  className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
                  aria-label="Your name"
                />
              </div>
              <p className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
                Online now
              </p>
              {peers.length === 0 && (
                <p className="px-4 py-2 text-zinc-500">
                  No one else is viewing this document.
                </p>
              )}
              {peers.map((peer, i) => (
                <div key={`${peer.name}-${i}`} className="flex items-center gap-2 px-4 py-1.5">
                  <span
                    className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                    style={{ backgroundColor: peer.color }}
                  >
                    {peer.name.replace("Guest ", "").slice(0, 3)}
                  </span>
                  <span className="truncate">
                    {peer.name}
                    {peer.name === localUser.name && (
                      <span className="text-zinc-400"> (you)</span>
                    )}
                  </span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>

      {showHistory && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowHistory(false)}
          />
          <div className="fixed right-4 z-50 mt-1 w-80 rounded-lg border border-zinc-200 bg-white py-2 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <p className="px-4 py-1 text-xs font-medium uppercase tracking-wide text-zinc-400">
              Version history
            </p>
            {versions.length === 0 && (
              <p className="px-4 py-2 text-zinc-500">
                No saved versions yet. Versions are saved automatically as you
                edit.
              </p>
            )}
            <div className="max-h-64 overflow-y-auto">
              {versions.map((v) => (
                <div
                  key={v.epoch}
                  className="flex items-center justify-between gap-2 px-4 py-1.5 hover:bg-zinc-50 dark:hover:bg-zinc-800"
                >
                  <span className="text-zinc-600 dark:text-zinc-300">
                    {formatTime(v.time)}
                  </span>
                  <button
                    disabled={busy}
                    onClick={() => restoreVersion(v.epoch)}
                    className="rounded border border-zinc-300 px-2 py-0.5 text-xs font-medium transition hover:bg-indigo-600 hover:text-white dark:border-zinc-700 disabled:opacity-50"
                  >
                    Restore
                  </button>
                </div>
              ))}
            </div>
            {versionMsg && (
              <p className="border-t border-zinc-200 px-4 py-2 text-xs text-indigo-600 dark:border-zinc-700 dark:text-indigo-400">
                {versionMsg}
              </p>
            )}
          </div>
        </>
      )}

      {showExport && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setShowExport(false)}
          />
          <div className="fixed right-4 z-50 mt-1 w-48 rounded-lg border border-zinc-200 bg-white py-1 text-sm shadow-lg dark:border-zinc-700 dark:bg-zinc-900">
            <button
              onClick={() => {
                exportMarkdown();
                setShowExport(false);
              }}
              className="block w-full px-4 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Markdown (.md)
            </button>
            <button
              onClick={() => {
                exportText();
                setShowExport(false);
              }}
              className="block w-full px-4 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Plain text (.txt)
            </button>
            <button
              onClick={() => {
                setShowExport(false);
                window.print();
              }}
              className="block w-full px-4 py-2 text-left transition hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              Print / PDF
            </button>
          </div>
        </>
      )}

      <Drawer
        open={showComments}
        onClose={() => setShowComments(false)}
        title="Comments"
      >
        <div className="p-4">
          <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
            <p className="mb-2 text-xs text-zinc-500">
              Select text in the document (optional), then add a comment.
            </p>
            <textarea
              value={commentDraft}
              onChange={(e) => setCommentDraft(e.target.value)}
              placeholder="Write a comment..."
              rows={3}
              className="w-full rounded-md border border-zinc-300 bg-transparent p-2 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
            />
            <button
              onClick={addComment}
              disabled={!commentDraft.trim()}
              className="mt-2 rounded-lg bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              Add comment
            </button>
          </div>

          {comments.length === 0 && (
            <p className="mt-4 text-sm text-zinc-500">
              No comments yet. Select some text and add the first comment.
            </p>
          )}

          <div className="mt-4 space-y-3">
            {comments.map((c) => (
              <div
                key={c.id}
                className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span
                      className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] text-white"
                      style={{ backgroundColor: c.authorColor }}
                    >
                      {c.authorName.replace("Guest ", "").slice(0, 3)}
                    </span>
                    <span className="text-sm font-medium">{c.authorName}</span>
                    <span className="text-xs text-zinc-400">
                      {formatTime(c.createdAt)}
                    </span>
                  </div>
                  <button
                    onClick={() => deleteComment(c.id)}
                    className="text-xs text-zinc-400 transition hover:text-red-500"
                    title="Delete comment"
                  >
                    Delete
                  </button>
                </div>
                {c.selection && (
                  <p className="mt-2 rounded bg-zinc-100 px-2 py-1 text-xs italic text-zinc-500 dark:bg-zinc-800">
                    “{c.selection.slice(0, 120)}”
                  </p>
                )}
                <p className="mt-2 text-sm whitespace-pre-wrap">{c.text}</p>

                <div className="mt-2 space-y-2">
                  {c.replies.map((r) => (
                    <div key={r.id} className="flex items-start gap-2">
                      <span
                        className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[9px] text-white"
                        style={{ backgroundColor: r.authorColor }}
                      >
                        {r.authorName.replace("Guest ", "").slice(0, 2)}
                      </span>
                      <div className="min-w-0">
                        <span className="text-xs font-medium">
                          {r.authorName}
                        </span>
                        <p className="text-sm whitespace-pre-wrap">{r.text}</p>
                      </div>
                    </div>
                  ))}
                  <div className="flex gap-2">
                    <input
                      value={replyDrafts[c.id] ?? ""}
                      onChange={(e) =>
                        setReplyDrafts((d) => ({ ...d, [c.id]: e.target.value }))
                      }
                      onKeyDown={(e) => {
                        if (e.key === "Enter") replyTo(c.id);
                      }}
                      placeholder="Reply..."
                      className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
                    />
                    <button
                      onClick={() => replyTo(c.id)}
                      disabled={!(replyDrafts[c.id] ?? "").trim()}
                      className="rounded-md bg-zinc-800 px-2.5 py-1 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-50"
                    >
                      Reply
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </Drawer>

      <Drawer open={showChat} onClose={() => setShowChat(false)} title="Chat">
        <div ref={chatRef} className="flex min-h-0 flex-1 flex-col gap-2 p-4">
          {chat.length === 0 && (
            <p className="text-sm text-zinc-500">
              No messages yet. Say hi to your collaborators!
            </p>
          )}
          {chat.map((m) => (
            <div key={m.id} className="flex items-start gap-2">
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] text-white"
                style={{ backgroundColor: m.authorColor }}
              >
                {m.authorName.replace("Guest ", "").slice(0, 3)}
              </span>
              <div className="min-w-0 rounded-lg bg-zinc-100 px-3 py-1.5 dark:bg-zinc-800">
                <div className="flex items-baseline gap-2">
                  <span className="text-xs font-semibold">{m.authorName}</span>
                  <span className="text-[10px] text-zinc-400">
                    {new Date(m.createdAt).toLocaleTimeString("en-US", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">
                  {m.text}
                </p>
              </div>
            </div>
          ))}
        </div>
        <form
          className="border-t border-zinc-200 p-3 dark:border-zinc-800"
          onSubmit={(e) => {
            e.preventDefault();
            sendChat();
          }}
        >
          <div className="flex gap-2">
            <input
              value={chatDraft}
              onChange={(e) => setChatDraft(e.target.value)}
              placeholder="Type a message..."
              className="min-w-0 flex-1 rounded-md border border-zinc-300 bg-transparent px-2 py-1.5 text-sm outline-none focus:border-indigo-500 dark:border-zinc-700"
            />
            <button
              type="submit"
              disabled={!chatDraft.trim()}
              className="rounded-md bg-indigo-600 px-3 py-1.5 text-sm font-medium text-white transition hover:bg-indigo-500 disabled:opacity-50"
            >
              Send
            </button>
          </div>
        </form>
      </Drawer>
    </div>
  );
}

export default function Editor({
  docId,
  initialTitle,
  initialReactions,
  initialComments,
  initialReadOnly,
}: {
  docId: string;
  initialTitle: string;
  initialReactions: Reaction[];
  initialComments: Comment[];
  initialReadOnly: boolean;
}) {
  const [sessionKey, setSessionKey] = useState(0);
  const handleReset = useCallback(() => setSessionKey((k) => k + 1), []);

  return (
    <Session
      key={sessionKey}
      docId={docId}
      initialTitle={initialTitle}
      initialReactions={initialReactions}
      initialComments={initialComments}
      initialReadOnly={initialReadOnly}
      onReset={handleReset}
    />
  );
}