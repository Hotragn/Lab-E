"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  createStore,
  loadPersisted,
  persist,
  type Action,
  type Store,
} from "@/lib/domain/store";
import { createSeedState } from "@/lib/domain/seed";
import type { OpResult, LabeState } from "@/lib/domain/types";
import {
  LabeBridge,
  type BridgeStatus,
  type RegisteredTool,
  type ResultMode,
} from "./bridge";
import type { JSONSchemaObject } from "./types";

/**
 * Wire the store, the WebMCP bridge and the clock together.
 *
 * The clock matters more than it looks. Grants expire on wall time, so
 * something has to notice — a second-resolution tick sweeps expired authority,
 * which fires the AbortControllers, which removes tools from the surface. The
 * countdown shown in the UI is the same countdown that governs what
 * the agent can call.
 */

export interface ConsoleApi {
  ready: boolean;
  state: LabeState;
  tools: RegisteredTool[];
  status: BridgeStatus;
  now: number;
  dispatch: (action: Action) => OpResult;
  invoke: (name: string, input: Record<string, unknown>) => Promise<{
    ok: boolean;
    text: string;
  }>;
  describe: (name: string) => { description: string; inputSchema: JSONSchemaObject } | null;
  reset: () => void;
}

const TICK_MS = 1000;

function readResultMode(): ResultMode {
  if (typeof window === "undefined") return "content";
  const mode = new URLSearchParams(window.location.search).get("resultMode");
  return mode === "string" ? "string" : "content";
}

export function useConsole(): ConsoleApi {
  // A stable pre-mount placeholder so render is never given a null state and
  // never rebuilds the seed on the way past.
  const fallbackRef = useRef<LabeState | null>(null);
  const storeRef = useRef<Store | null>(null);
  const bridgeRef = useRef<LabeBridge | null>(null);

  const [ready, setReady] = useState(false);
  const [state, setState] = useState<LabeState | null>(null);
  const [tools, setTools] = useState<RegisteredTool[]>([]);
  const [status, setStatus] = useState<BridgeStatus>({
    surface: "none",
    live: false,
    registered: 0,
  });
  const [now, setNow] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const start = Date.now();

    const store = createStore(loadPersisted(start));
    storeRef.current = store;
    setState(store.getState());
    setNow(start);

    const bridge = new LabeBridge({
      getState: () => store.getState(),
      dispatch: (action) => store.dispatch(action),
      now: () => Date.now(),
      onChange: (next) => {
        if (!cancelled) setTools(next);
      },
      resultMode: readResultMode(),
    });
    bridgeRef.current = bridge;

    const unsubscribe = store.subscribe((next) => {
      if (cancelled) return;
      setState(next);
      persist(next);
      bridge.sync();
    });

    void bridge.start().then((s) => {
      if (cancelled) return;
      setStatus(s);
      setTools(bridge.registeredTools());
      setReady(true);
    });

    const timer = window.setInterval(() => {
      if (cancelled) return;
      const t = Date.now();
      setNow(t);
      // Sweeps expired grants; a no-op when nothing has lapsed.
      store.dispatch({ type: "tick", at: t });
      bridge.sync();
    }, TICK_MS);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      unsubscribe();
      bridge.stop();
    };
  }, []);

  const dispatch = useCallback((action: Action): OpResult => {
    const store = storeRef.current;
    if (!store) return { ok: false, error: "Console is still starting." };
    return store.dispatch(action);
  }, []);

  const invoke = useCallback(
    async (name: string, input: Record<string, unknown>) => {
      const bridge = bridgeRef.current;
      if (!bridge) return { ok: false, text: "Console is still starting." };
      return bridge.invoke(name, input);
    },
    [],
  );

  const describe = useCallback(
    (name: string) => bridgeRef.current?.descriptor(name) ?? null,
    [],
  );

  const reset = useCallback(() => {
    dispatch({ type: "reset", at: Date.now() });
  }, [dispatch]);

  return {
    ready,
    state: state ?? (fallbackRef.current ??= createSeedState(0)),
    tools,
    status,
    now,
    dispatch,
    invoke,
    describe,
    reset,
  };
}
