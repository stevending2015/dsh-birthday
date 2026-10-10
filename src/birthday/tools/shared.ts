/**
 * Shared helpers for birthday tool definitions.
 */

/**
 * Model-visible text projection of a tool's canonical JSON value.
 * @param _args - validated call arguments (unused; the value carries everything).
 * @param value - canonical value returned by `execute`.
 * @returns A single text content block holding pretty-printed JSON.
 */
export function jsonRender(_args: unknown, value: unknown): Array<{ type: 'text'; text: string }> {
  return [{ type: 'text', text: JSON.stringify(value, null, 2) }];
}

/**
 * Presentation metadata for the native call card.
 * @param title - card title shown while the call runs.
 * @param kind - card category; DSH renders read/other differently.
 * @returns The `presentCall` payload.
 */
export function presentCall(title: string, kind: 'read' | 'other' = 'read'): {
  card: 'generic';
  title: string;
  kind: 'read' | 'other';
} {
  return { card: 'generic', title, kind };
}
