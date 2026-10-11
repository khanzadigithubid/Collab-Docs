export type Reaction = {
  emoji: string;
  count: number;
};

export type CommentReply = {
  id: string;
  authorName: string;
  authorColor: string;
  text: string;
  createdAt: number;
};

export type Comment = {
  id: string;
  authorName: string;
  authorColor: string;
  text: string;
  selection?: string;
  createdAt: number;
  replies: CommentReply[];
};

export type ChatMessage = {
  id: string;
  authorName: string;
  authorColor: string;
  text: string;
  createdAt: number;
};

export type DocumentMeta = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  reactions?: Reaction[];
  comments?: Comment[];
  starred?: boolean;
  lastViewedAt?: number;
};

export type DocumentVersion = {
  epoch: number;
  time: number;
};

export type DocumentSummary = DocumentMeta;
