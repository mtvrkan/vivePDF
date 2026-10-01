import { useEffect, useRef } from "react";
import { listen, type EventCallback } from "@tauri-apps/api/event";

export function useTauriEvent<T>(name: string, handler: EventCallback<T>) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    listen<T>(name, (event) => handlerRef.current(event))
      .then((fn) => {
        if (disposed) fn();
        else unlisten = fn;
      })
      .catch(() => undefined);
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [name]);
}
