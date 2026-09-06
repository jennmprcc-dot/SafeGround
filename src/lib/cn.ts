/** Tiny cn() helper — dependency-free class combiner. */
export function cn(...parts: Array<string | false | null | undefined>) {
  return parts.filter(Boolean).join(" ");
}