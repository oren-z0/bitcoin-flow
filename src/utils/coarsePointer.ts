/** True for phones/tablets where hover-centric UI is costly or misleading. */
export function prefersCoarsePointer(): boolean {
  if (typeof window === 'undefined') return false;
  return window.matchMedia('(pointer: coarse)').matches;
}
