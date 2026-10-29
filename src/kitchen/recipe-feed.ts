import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api.ts";

type RecipeSummary = { id: string; [field: string]: any };
type RecipePage = { items: RecipeSummary[]; total: number };
type Feed = {
  key: string;
  items: RecipeSummary[];
  total: number | null;
  loading: boolean;
  error: string;
  hasMore: boolean;
};
const emptyFeed = (key: string): Feed => ({
  key,
  items: [],
  total: null,
  loading: true,
  error: "",
  hasMore: true,
});

export function useRecipeFeed(query: string) {
  const [revision, setRevision] = useState(0);
  const [feed, setFeed] = useState(() => emptyFeed(query));
  const request = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    let offset = 0,
      inFlight = false,
      hasMore = true;
    setFeed(emptyFeed(query));
    async function next() {
      if (controller.signal.aborted || inFlight || !hasMore) return;
      inFlight = true;
      setFeed((old) => ({ ...old, loading: true, error: "" }));
      try {
        const params = new URLSearchParams(query);
        params.set("offset", String(offset));
        params.set("limit", "24");
        const page = await api<RecipePage>(
          "/recipes?" + params,
          "GET",
          undefined,
          undefined,
          controller.signal,
        );
        if (controller.signal.aborted) return;
        offset += page.items.length;
        hasMore = page.items.length > 0 && offset < page.total;
        setFeed((old) => ({
          ...old,
          items: [
            ...new Map(
              [...old.items, ...page.items].map((r) => [r.id, r]),
            ).values(),
          ],
          total: page.total,
          hasMore,
          loading: false,
        }));
      } catch (error) {
        if (!controller.signal.aborted)
          setFeed((old) => ({
            ...old,
            loading: false,
            error: (error as Error).message,
          }));
      } finally {
        inFlight = false;
      }
    }
    request.current = next;
    void next();
    return () => {
      controller.abort();
      request.current = null;
    };
  }, [query, revision]);
  const loadMore = useCallback(() => {
    void request.current?.();
  }, []);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  const updateItem = useCallback(
    (id: string, values: Partial<RecipeSummary>) => {
      setFeed((old) => ({
        ...old,
        items: old.items.map((r) => (r.id === id ? { ...r, ...values } : r)),
      }));
    },
    [],
  );
  const current = feed.key === query ? feed : emptyFeed(query);
  return {
    data:
      current.total === null
        ? null
        : { items: current.items, total: current.total },
    loading: current.total === null && current.loading,
    loadingMore: current.total !== null && current.loading,
    error: current.error,
    hasMore: current.hasMore,
    loadMore,
    reload,
    updateItem,
  };
}
