import { create } from "zustand";

const FRESH_MS = 5000;

type SearchRequestState = {
  query: string;
  nonce: number;
  at: number;
  handled: Record<string, number>;
  requestSearch: (query: string) => void;
  isPending: (consumer: string, now?: number) => boolean;
  take: (consumer: string, now?: number) => string | null;
};

export const useSearchRequestStore = create<SearchRequestState>((set, get) => ({
  query: "",
  nonce: 0,
  at: 0,
  handled: {},
  requestSearch: (query) => set({ query, nonce: get().nonce + 1, at: Date.now() }),
  isPending: (consumer, now = Date.now()) => {
    const state = get();
    return state.nonce > (state.handled[consumer] ?? 0) && now - state.at <= FRESH_MS;
  },
  take: (consumer, now = Date.now()) => {
    const state = get();
    if (!state.isPending(consumer, now)) return null;
    set({ handled: { ...state.handled, [consumer]: state.nonce } });
    return state.query;
  },
}));
