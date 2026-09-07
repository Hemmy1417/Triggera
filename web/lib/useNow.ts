"use client";

import { useEffect, useState } from "react";

/**
 * A coarse now, in seconds, refreshed every half minute.
 *
 * Display gating only: the CONTRACT enforces every window with its own
 * consensus clock, and this number decides nothing. It lives in state rather
 * than being read during render so a component stays pure between renders
 * and every page agrees on the same tick.
 */
export function useNow(): number {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const t = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 30_000);
    return () => clearInterval(t);
  }, []);
  return now;
}
