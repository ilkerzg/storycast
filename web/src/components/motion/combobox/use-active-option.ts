"use client";

import { useCallback, useLayoutEffect, useRef, useState } from "react";

type ActiveCursor = { value: string; query: string };

type Options = {
  query: string;
  value: string | undefined;
  enabledItems: readonly { value: string }[];
};

const isEnabled = (
  enabledItems: Options["enabledItems"],
  candidate: string | undefined,
): candidate is string =>
  candidate !== undefined && enabledItems.some((i) => i.value === candidate);

function liveCursorValue(cursor: ActiveCursor | null, options: Options) {
  if (cursor === null || cursor.query !== options.query) return null;
  return isEnabled(options.enabledItems, cursor.value) ? cursor.value : null;
}

function fallbackActive({ value, enabledItems }: Options) {
  return isEnabled(enabledItems, value) ? value : (enabledItems[0]?.value ?? null);
}

const resolveActive = (cursor: ActiveCursor | null, options: Options) =>
  liveCursorValue(cursor, options) ?? fallbackActive(options);

export function useActiveOption({ open, ...options }: Options & { open: boolean }) {
  const { query, value, enabledItems } = options;
  const [cursor, setCursor] = useState<ActiveCursor | null>(null);

  const live = liveCursorValue(cursor, options);

  if (cursor !== null && live === null) setCursor(null);
  const derived = live ?? fallbackActive(options);

  const [opened, setOpened] = useState(open);
  if (open && !opened) setOpened(true);
  const activeValue = opened ? derived : null;

  const latest = useRef({ open, query, value, enabledItems });
  useLayoutEffect(() => {
    latest.current = { open, query, value, enabledItems };
  });

  const setActiveValue = useCallback((next: string | null) => {
    setCursor(
      next === null ? null : { value: next, query: latest.current.query },
    );
  }, []);

  const moveActive = useCallback(
    (direction: 1 | -1 | "first" | "last") => {
      const options = latest.current;

      if (!options.open) return;
      const rows = options.enabledItems;
      const last = rows.length - 1;
      if (last < 0) {
        setCursor(null);
        return;
      }
      setCursor((current) => {
        const from = resolveActive(current, options);
        const at = rows.findIndex((item) => item.value === from);
        const index =
          direction === "first"
            ? 0
            : direction === "last"
              ? last
              : (at + direction + rows.length) % rows.length;
        return { value: rows[index].value, query: options.query };
      });
    },
    [],
  );

  return { activeValue, setActiveValue, moveActive };
}
