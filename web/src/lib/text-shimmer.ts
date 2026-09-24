import type { CSSProperties } from "react";

export const TEXT_SHIMMER_KEYFRAMES =
  "@keyframes beui-text-shimmer{from{background-position:200% 0}to{background-position:-200% 0}}" +
  "@media (prefers-reduced-motion: reduce){.beui-text-shimmer{animation:none !important}}";

export const TEXT_SHIMMER_CLASS_NAME =
  "beui-text-shimmer bg-[length:200%_100%] bg-clip-text text-transparent bg-[linear-gradient(110deg,var(--muted-foreground)_30%,var(--foreground)_50%,var(--muted-foreground)_70%)]";

export function textShimmerStyle(duration: number): CSSProperties {
  return {
    animation: `beui-text-shimmer ${duration}s linear infinite`,
  };
}
