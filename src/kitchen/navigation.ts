import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { go } from "./api.ts";

type Entry = { id: string; route: string; from: string | null };
const routeFromLocation = () => window.location.hash.slice(1) || "/recipes";
function entryFor(route: string, from: string | null): Entry {
  const stored = window.history.state?.kitchenNavigation as Entry | undefined;
  if (stored?.id && stored.route === route) return stored;
  const entry: Entry = { id: crypto.randomUUID(), route, from };
  window.history.replaceState(
    { ...window.history.state, kitchenNavigation: entry }, "",
  );
  return entry;
}

// Keep positions in this tab's memory, separate for each browser history entry.
export function useKitchenNavigation() {
  const [route, setRoute] = useState(routeFromLocation);
  const current = useRef<Entry | null>(null);
  const positions = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const previousRestoration = window.history.scrollRestoration;
    window.history.scrollRestoration = "manual";
    current.current = entryFor(routeFromLocation(), null);
    const change = () => {
      const previous = current.current;
      if (previous) positions.current.set(previous.id, window.scrollY);
      const nextRoute = routeFromLocation();
      current.current = entryFor(nextRoute, previous?.route ?? null);
      setRoute(nextRoute);
    };
    window.addEventListener("hashchange", change);
    return () => {
      window.removeEventListener("hashchange", change);
      window.history.scrollRestoration = previousRestoration;
    };
  }, []);
  useLayoutEffect(() => {
    const target = positions.current.get(current.current?.id ?? "") ?? 0;
    let observer: ResizeObserver | undefined;
    let frame = 0;
    const stop = () => {
      observer?.disconnect();
      cancelAnimationFrame(frame);
      for (const event of ["pointerdown", "touchstart", "wheel", "keydown"])
        window.removeEventListener(event, stop);
    };
    const restore = () => {
      window.scrollTo({ top: target, behavior: "instant" });
      if (Math.abs(window.scrollY - target) <= 1) stop();
    };
    restore();
    // Data may still be loading when returning to another screen.
    if (target > 0 && Math.abs(window.scrollY - target) > 1) {
      observer = new ResizeObserver(() => {
        cancelAnimationFrame(frame);
        frame = requestAnimationFrame(restore);
      });
      const main = document.getElementById("k-main");
      if (main) observer.observe(main);
      for (const event of ["pointerdown", "touchstart", "wheel", "keydown"])
        window.addEventListener(event, stop, { passive: true });
    }
    return stop;
  }, [route]);
  const back = useCallback(() => {
    if (window.history.state?.kitchenNavigation?.from)
      window.history.back();
    else go("/recipes");
  }, []);
  return { route, back };
}
