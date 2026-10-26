import { create } from "zustand";
import { commentAuthor } from "./comments";

const SHOWN_KEY = "vivepdf.documentComments";
const AUTHOR_KEY = "vivepdf.commentAuthor";

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    return;
  }
}

type CommentsViewState = {
  shown: boolean;
  author: string;
  naming: boolean;
  setShown: (shown: boolean) => void;
  setAuthor: (author: string) => void;
  setNaming: (naming: boolean) => void;
};

export const useCommentsView = create<CommentsViewState>((set) => ({
  shown: read(SHOWN_KEY) !== "false",
  author: commentAuthor(read(AUTHOR_KEY)),
  naming: false,
  setShown: (shown) => {
    write(SHOWN_KEY, String(shown));
    set({ shown });
  },
  setAuthor: (value) => {
    const author = commentAuthor(value);
    write(AUTHOR_KEY, author);
    set({ author });
  },
  setNaming: (naming) => set({ naming }),
}));
