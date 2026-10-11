"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { EditorContent, useEditor, useEditorState, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import Underline from "@tiptap/extension-underline";
import { TextStyle } from "@tiptap/extension-text-style";
import Color from "@tiptap/extension-color";
import TextAlign from "@tiptap/extension-text-align";
import Image from "@tiptap/extension-image";
import { Table } from "@tiptap/extension-table";
import TableRow from "@tiptap/extension-table-row";
import TableHeader from "@tiptap/extension-table-header";
import TableCell from "@tiptap/extension-table-cell";
import Collaboration from "@tiptap/extension-collaboration";
import CollaborationCaret from "@tiptap/extension-collaboration-caret";
import type * as Y from "yjs";
import type { WebsocketProvider } from "y-websocket";
import type { CollabUser } from "@/lib/presence";

function renderCaret(user: CollabUser): HTMLElement {
  const caret = document.createElement("span");
  caret.classList.add("collab-caret");
  caret.style.borderColor = user.color;

  const label = document.createElement("span");
  label.classList.add("collab-caret__label");
  label.style.backgroundColor = user.color;
  label.textContent = user.name;
  caret.append(label);

  return caret;
}

type ToolbarButtonProps = {
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  title: string;
  children: React.ReactNode;
};

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children,
}: ToolbarButtonProps) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-2 py-1 text-sm transition disabled:opacity-30 ${
        active
          ? "bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300"
          : "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
      }`}
    >
      {children}
    </button>
  );
}

type Props = {
  ydoc: Y.Doc;
  provider: WebsocketProvider;
  user: CollabUser;
  editable: boolean;
  editorRef?: { current: Editor | null };
};

export default function CollaborativeEditor({
  ydoc,
  provider,
  user,
  editable,
  editorRef,
}: Props) {
  const [ready, setReady] = useState(false);
  const syncedRef = useRef(false);

  const editor = useEditor({
    immediatelyRender: false,
    editable,
    extensions: [
      StarterKit.configure({ undoRedo: false }),
      Placeholder.configure({
        placeholder: "Start writing, or share the link to collaborate...",
      }),
      Highlight,
      Underline,
      TextStyle,
      Color,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Image,
      Table.configure({ resizable: true }),
      TableRow,
      TableHeader,
      TableCell,
      Collaboration.configure({ document: ydoc, provider }),
      CollaborationCaret.configure({ provider, user, render: renderCaret }),
    ],
    editorProps: {
      attributes: {
        class: "tiptap-content",
        spellcheck: "true",
      },
    },
    onCreate: () => setReady(true),
  });

  useEffect(() => {
    if (editor) editor.setEditable(editable);
  }, [editor, editable]);

  useEffect(() => {
    if (!editorRef) return;
    editorRef.current = editor;
    return () => {
      editorRef.current = null;
    };
  }, [editor, editorRef]);

  useEffect(() => {
    const onSync = (isSynced: boolean) => {
      if (isSynced) syncedRef.current = true;
    };
    provider.on("sync", onSync);
    return () => {
      provider.off("sync", onSync);
    };
  }, [provider]);

  const state = useEditorState({
    editor,
    selector: ({ editor }) => {
      if (!editor) return null;
      return {
        bold: editor.isActive("bold"),
        italic: editor.isActive("italic"),
        underline: editor.isActive("underline"),
        strike: editor.isActive("strike"),
        code: editor.isActive("code"),
        h1: editor.isActive("heading", { level: 1 }),
        h2: editor.isActive("heading", { level: 2 }),
        bulletList: editor.isActive("bulletList"),
        orderedList: editor.isActive("orderedList"),
        blockquote: editor.isActive("blockquote"),
        codeBlock: editor.isActive("codeBlock"),
        link: editor.isActive("link"),
        highlight: editor.isActive("highlight"),
        alignLeft: editor.isActive({ textAlign: "left" }),
        alignCenter: editor.isActive({ textAlign: "center" }),
        alignRight: editor.isActive({ textAlign: "right" }),
        table: editor.isActive("table"),
        canAddRow: editor.can().addRowAfter(),
        canAddCol: editor.can().addColumnAfter(),
        color:
          (editor.getAttributes("textStyle").color as string | undefined) ||
          "#000000",
        canUndo: editor.can().undo(),
        canRedo: editor.can().redo(),
      };
    },
  });

  const setLink = useCallback(() => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous ?? "https://");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor
      .chain()
      .focus()
      .extendMarkRange("link")
      .setLink({ href: url })
      .run();
  }, [editor]);

  const setImageUrl = useCallback(() => {
    if (!editor) return;
    const url = window.prompt("Image URL (paste a link or data: URL)");
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const handleImageFile = useCallback(
    (file: File | undefined) => {
      if (!file || !editor) return;
      void (async () => {
        try {
          const dataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error("read failed"));
            reader.readAsDataURL(file);
          });
          const src = await new Promise<string>((resolve) => {
            const img = new window.Image();
            img.onload = () => {
              try {
                const maxDim = 1600;
                const ratio = Math.min(
                  1,
                  maxDim / Math.max(img.width, img.height),
                );
                const canvas = document.createElement("canvas");
                canvas.width = Math.max(1, Math.round(img.width * ratio));
                canvas.height = Math.max(1, Math.round(img.height * ratio));
                canvas
                  .getContext("2d")
                  ?.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve(canvas.toDataURL("image/jpeg", 0.85));
              } catch {
                resolve(dataUrl);
              }
            };
            img.onerror = () => resolve(dataUrl);
            img.src = dataUrl;
          });
          editor.chain().focus().setImage({ src }).run();
        } catch {
          /* ignore failed upload */
        }
      })();
    },
    [editor],
  );

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex flex-wrap items-center gap-1 border-b border-zinc-200 px-3 py-2 dark:border-zinc-800">
        <ToolbarButton
          title="Undo"
          onClick={() => editor?.chain().focus().undo().run()}
          disabled={!state?.canUndo}
        >
          ↺
        </ToolbarButton>
        <ToolbarButton
          title="Redo"
          onClick={() => editor?.chain().focus().redo().run()}
          disabled={!state?.canRedo}
        >
          ↻
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        <ToolbarButton
          title="Bold"
          active={state?.bold}
          onClick={() => editor?.chain().focus().toggleBold().run()}
        >
          <b>B</b>
        </ToolbarButton>
        <ToolbarButton
          title="Italic"
          active={state?.italic}
          onClick={() => editor?.chain().focus().toggleItalic().run()}
        >
          <i>I</i>
        </ToolbarButton>
        <ToolbarButton
          title="Underline"
          active={state?.underline}
          onClick={() => editor?.chain().focus().toggleUnderline().run()}
        >
          <u>U</u>
        </ToolbarButton>
        <ToolbarButton
          title="Strikethrough"
          active={state?.strike}
          onClick={() => editor?.chain().focus().toggleStrike().run()}
        >
          <s>S</s>
        </ToolbarButton>
        <ToolbarButton
          title="Highlight"
          active={state?.highlight}
          onClick={() => editor?.chain().focus().toggleHighlight().run()}
        >
          ▨
        </ToolbarButton>
        <label
          title="Text color"
          className="relative inline-flex h-6 w-6 cursor-pointer items-center justify-center rounded-md border border-zinc-300 text-[10px] font-bold text-zinc-600 transition hover:bg-zinc-100 dark:border-zinc-700 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          <span
            className="absolute bottom-1 left-1/2 h-1 w-3 -translate-x-1/2 rounded-sm"
            style={{ backgroundColor: state?.color || "#000000" }}
          />
          <input
            type="color"
            value={state?.color || "#000000"}
            onChange={(e) =>
              editor?.chain().focus().setColor(e.target.value).run()
            }
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Text color"
          />
        </label>
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        <ToolbarButton
          title="Align left"
          active={state?.alignLeft}
          onClick={() => editor?.chain().focus().setTextAlign("left").run()}
        >
          ⇤
        </ToolbarButton>
        <ToolbarButton
          title="Align center"
          active={state?.alignCenter}
          onClick={() => editor?.chain().focus().setTextAlign("center").run()}
        >
          ⇹
        </ToolbarButton>
        <ToolbarButton
          title="Align right"
          active={state?.alignRight}
          onClick={() => editor?.chain().focus().setTextAlign("right").run()}
        >
          ⇥
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        <ToolbarButton
          title="Heading 1"
          active={state?.h1}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 1 }).run()
          }
        >
          H1
        </ToolbarButton>
        <ToolbarButton
          title="Heading 2"
          active={state?.h2}
          onClick={() =>
            editor?.chain().focus().toggleHeading({ level: 2 }).run()
          }
        >
          H2
        </ToolbarButton>
        <ToolbarButton
          title="Bullet list"
          active={state?.bulletList}
          onClick={() => editor?.chain().focus().toggleBulletList().run()}
        >
          • List
        </ToolbarButton>
        <ToolbarButton
          title="Numbered list"
          active={state?.orderedList}
          onClick={() => editor?.chain().focus().toggleOrderedList().run()}
        >
          1. List
        </ToolbarButton>
        <ToolbarButton
          title="Quote"
          active={state?.blockquote}
          onClick={() => editor?.chain().focus().toggleBlockquote().run()}
        >
          &rdquo;
        </ToolbarButton>
        <ToolbarButton
          title="Code block"
          active={state?.codeBlock}
          onClick={() => editor?.chain().focus().toggleCodeBlock().run()}
        >
          {"</>"}
        </ToolbarButton>
        <ToolbarButton
          title="Inline code"
          active={state?.code}
          onClick={() => editor?.chain().focus().toggleCode().run()}
        >
          {"`"}
        </ToolbarButton>
        <ToolbarButton title="Link" active={state?.link} onClick={setLink}>
          🔗
        </ToolbarButton>
        <span className="mx-1 h-5 w-px bg-zinc-200 dark:bg-zinc-800" />
        <ToolbarButton
          title="Insert table"
          active={state?.table}
          onClick={() =>
            editor
              ?.chain()
              .focus()
              .insertTable({ rows: 3, cols: 3, withHeaderRow: true })
              .run()
          }
        >
          ▦
        </ToolbarButton>
        <ToolbarButton
          title="Add table row"
          disabled={!state?.canAddRow}
          onClick={() => editor?.chain().focus().addRowAfter().run()}
        >
          +row
        </ToolbarButton>
        <ToolbarButton
          title="Add table column"
          disabled={!state?.canAddCol}
          onClick={() => editor?.chain().focus().addColumnAfter().run()}
        >
          +col
        </ToolbarButton>
        <ToolbarButton
          title="Delete table"
          disabled={!state?.table}
          onClick={() => editor?.chain().focus().deleteTable().run()}
        >
          🗑
        </ToolbarButton>
        <label
          title="Upload image"
          className="cursor-pointer rounded-md px-2 py-1 text-sm text-zinc-600 transition hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800"
        >
          🖼
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(e) => {
              handleImageFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        <ToolbarButton title="Insert image from URL" onClick={setImageUrl}>
          URL
        </ToolbarButton>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {!ready && (
          <p className="px-6 py-4 text-sm text-zinc-400">Loading editor...</p>
        )}
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}