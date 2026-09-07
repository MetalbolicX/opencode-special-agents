/**
 * Continuation state — pure types and functions
 *
 * Provides:
 * - actionableTodoFilter: keeps only pending / in_progress todos
 * - fingerprint: stable, order-independent hash of actionable todos
 * - ContinuationSessionState: per-session guard state
 * - decision: one-nudge policy decision (allow / deny with reason)
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface Todo {
  id: string;
  status: "pending" | "in_progress" | "completed" | "cancelled";
  content: string;
  priority?: number;
}

export interface SessionContinuationState {
  sessionId: string;
  /** Number of continuations already consumed */
  continuationCount: number;
  /** Fingerprint of the last actionable set — retained on prompt failure */
  lastFingerprint: string | null;
  /** True while a synthetic turn is in flight (waiting for the next idle) */
  inFlight: boolean;
}

export type ActionableTodo = Extract<Todo, { status: "pending" | "in_progress" }>;

// ---------------------------------------------------------------------------
// Actionable filter
// ---------------------------------------------------------------------------

/** Returns only todos whose status is exactly pending or in_progress */
export function actionableTodoFilter(todos: Todo[]): ActionableTodo[] {
  return todos.filter(
    (t): t is ActionableTodo => t.status === "pending" || t.status === "in_progress"
  );
}

// ---------------------------------------------------------------------------
// Stable fingerprint
// ---------------------------------------------------------------------------

/**
 * Produces a deterministic, order-independent fingerprint from actionable todos.
 * Uses a stable property sort so the hash does not depend on array ordering.
 */
export function fingerprint(actionableTodos: ActionableTodo[]): string {
  if (actionableTodos.length === 0) return "empty";

  const parts = [...actionableTodos]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((t) => `${t.id}:${t.status}:${t.priority ?? 0}:${t.content}`);

  return hashString(parts.join("|"));
}

/** Simple djb2-style string hash — pure, no external deps */
export function hashString(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) + h) ^ s.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h.toString(16);
}

// ---------------------------------------------------------------------------
// Continuation decision
// ---------------------------------------------------------------------------

export type Decision =
  | { allowed: true }
  | { allowed: false; reason: DecisionReason };

export type DecisionReason =
  | "no_actionable_todos"
  | "already_in_flight"
  | "fingerprint_unchanged"
  | "continuation_exhausted";

export interface GuardState {
  continuationCount: number;
  lastFingerprint: string | null;
  inFlight: boolean;
  currentFingerprint: string;
}

export const MAX_CONTINUATIONS = 1;

/**
 * Returns whether a continuation nudge should be allowed.
 *
 * Guards:
 * - no actionable todos → deny
 * - already in-flight → deny
 * - same fingerprint (unchanged state) → deny
 * - already consumed the one nudge → deny
 */
export function decision(guard: GuardState): Decision {
  if (guard.continuationCount >= MAX_CONTINUATIONS) {
    return { allowed: false, reason: "continuation_exhausted" };
  }
  if (guard.inFlight) {
    return { allowed: false, reason: "already_in_flight" };
  }
  if (guard.lastFingerprint !== null && guard.lastFingerprint === guard.currentFingerprint) {
    return { allowed: false, reason: "fingerprint_unchanged" };
  }
  if (guard.currentFingerprint === "empty") {
    return { allowed: false, reason: "no_actionable_todos" };
  }
  return { allowed: true };
}

// ---------------------------------------------------------------------------
// In-memory state store (exported for testing convenience)
// ---------------------------------------------------------------------------

export class ContinuationStateStore {
  private store = new Map<string, SessionContinuationState>();

  get(sessionId: string): SessionContinuationState {
    if (!this.store.has(sessionId)) {
      this.store.set(sessionId, {
        sessionId,
        continuationCount: 0,
        lastFingerprint: null,
        inFlight: false,
      });
    }
    // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
    return this.store.get(sessionId)!;
  }

  /** Clear the in-flight flag — called when the synthetic idle event fires */
  clearInFlight(sessionId: string): void {
    const state = this.get(sessionId);
    state.inFlight = false;
  }

  /**
   * Reserve state before calling promptAsync.
   * Sets inFlight=true, bumps continuationCount, records fingerprint.
   * Call this atomically before the async prompt call.
   */
  reserve(sessionId: string, fingerprint: string): void {
    const state = this.get(sessionId);
    state.inFlight = true;
    state.continuationCount += 1;
    state.lastFingerprint = fingerprint;
  }

  /**
   * Called when promptAsync fails.
   * Clears inFlight but keeps the consumed count and fingerprint
   * so the same fingerprint won't auto-retry.
   */
  failClosed(sessionId: string): void {
    const state = this.get(sessionId);
    state.inFlight = false;
    // lastFingerprint and continuationCount are intentionally retained
  }

  reset(sessionId: string): void {
    this.store.delete(sessionId);
  }
}
