/** Tiny immutable-array helpers used across the editor. */

export function updateAt<T>(arr: T[], index: number, value: T): T[] {
  const next = arr.slice();
  next[index] = value;
  return next;
}

export function removeAt<T>(arr: T[], index: number): T[] {
  return arr.filter((_, i) => i !== index);
}

export function insertAt<T>(arr: T[], index: number, value: T): T[] {
  const next = arr.slice();
  next.splice(index, 0, value);
  return next;
}

/** Move arr[from] to position `to` (indices clamped; no-op when equal). */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  const clamped = Math.max(0, Math.min(arr.length - 1, to));
  if (from === clamped) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(clamped, 0, item);
  return next;
}
