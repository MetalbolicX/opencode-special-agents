import {
  actionableTodoFilter,
  fingerprint,
  decision,
  hashString,
  ContinuationStateStore,
  type Todo,
  type ActionableTodo,
} from "../.opencode/lib/continuation-state.ts";
import { describe, expect, test, beforeEach } from "bun:test";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const baseTodo = (
  overrides: Partial<Todo> = {}
): Todo => ({
  id: "todo-1",
  status: "pending",
  content: "Fix the auth bug",
  priority: 1,
  ...overrides,
});

// ---------------------------------------------------------------------------
// actionableTodoFilter
// ---------------------------------------------------------------------------

test("pending todos are actionable", () => {
  const todos: Todo[] = [baseTodo({ id: "a", status: "pending" })];
  expect(actionableTodoFilter(todos)).toHaveLength(1);
});

test("in_progress todos are actionable", () => {
  const todos: Todo[] = [baseTodo({ id: "a", status: "in_progress" })];
  expect(actionableTodoFilter(todos)).toHaveLength(1);
});

test("completed todos are not actionable", () => {
  const todos: Todo[] = [baseTodo({ status: "completed" })];
  expect(actionableTodoFilter(todos)).toHaveLength(0);
});

test("cancelled todos are not actionable", () => {
  const todos: Todo[] = [baseTodo({ status: "cancelled" })];
  expect(actionableTodoFilter(todos)).toHaveLength(0);
});

test("mixed statuses — only pending and in_progress pass through", () => {
  const todos: Todo[] = [
    baseTodo({ id: "a", status: "pending" }),
    baseTodo({ id: "b", status: "in_progress" }),
    baseTodo({ id: "c", status: "completed" }),
    baseTodo({ id: "d", status: "cancelled" }),
  ];
  const result = actionableTodoFilter(todos);
  expect(result).toHaveLength(2);
  expect(result.map((t) => t.id)).toEqual(["a", "b"]);
});

// ---------------------------------------------------------------------------
// fingerprint
// ---------------------------------------------------------------------------

test("empty actionable list returns 'empty'", () => {
  expect(fingerprint([])).toBe("empty");
});

test("fingerprint is stable — same input always yields same hash", () => {
  const todos: ActionableTodo[] = [
    baseTodo({ id: "x", status: "pending", priority: 2 }),
    baseTodo({ id: "y", status: "in_progress", priority: 1 }),
  ];
  const fp = fingerprint(todos);
  expect(fingerprint(todos)).toBe(fp);
  expect(fingerprint(todos)).toBe(fp);
});

test("fingerprint is order-independent", () => {
  const a: ActionableTodo[] = [
    baseTodo({ id: "a", status: "pending" }),
    baseTodo({ id: "b", status: "in_progress" }),
  ];
  const b: ActionableTodo[] = [
    baseTodo({ id: "b", status: "in_progress" }),
    baseTodo({ id: "a", status: "pending" }),
  ];
  expect(fingerprint(a)).toBe(fingerprint(b));
});

test("different content produces different fingerprint", () => {
  const a: ActionableTodo[] = [baseTodo({ id: "a", content: "Alpha" })];
  const b: ActionableTodo[] = [baseTodo({ id: "a", content: "Beta" })];
  expect(fingerprint(a)).not.toBe(fingerprint(b));
});

test("different status produces different fingerprint", () => {
  const a: ActionableTodo[] = [baseTodo({ id: "a", status: "pending" })];
  const b: ActionableTodo[] = [baseTodo({ id: "a", status: "in_progress" })];
  expect(fingerprint(a)).not.toBe(fingerprint(b));
});

test("priority affects fingerprint", () => {
  const a: ActionableTodo[] = [baseTodo({ id: "a", priority: 1 })];
  const b: ActionableTodo[] = [baseTodo({ id: "a", priority: 2 })];
  expect(fingerprint(a)).not.toBe(fingerprint(b));
});

// ---------------------------------------------------------------------------
// hashString
// ---------------------------------------------------------------------------

test("hashString is deterministic", () => {
  const h = hashString("hello world");
  expect(hashString("hello world")).toBe(h);
});

test("different strings produce different hashes", () => {
  expect(hashString("a")).not.toBe(hashString("b"));
});

// ---------------------------------------------------------------------------
// decision
// ---------------------------------------------------------------------------

test("allows first actionable idle", () => {
  const guard: GuardState = {
    continuationCount: 0,
    lastFingerprint: null,
    inFlight: false,
    currentFingerprint: "abc123",
  };
  const result = decision(guard);
  expect(result.allowed).toBe(true);
});

test("denies when no actionable todos (empty fingerprint)", () => {
  const guard: GuardState = {
    continuationCount: 0,
    lastFingerprint: null,
    inFlight: false,
    currentFingerprint: "empty",
  };
  const result = decision(guard);
  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("no_actionable_todos");
});

test("denies when already in-flight", () => {
  const guard: GuardState = {
    continuationCount: 0,
    lastFingerprint: null,
    inFlight: true,
    currentFingerprint: "abc123",
  };
  const result = decision(guard);
  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("already_in_flight");
});

test("denies when fingerprint is unchanged", () => {
  const guard: GuardState = {
    continuationCount: 0,
    lastFingerprint: "abc123",
    inFlight: false,
    currentFingerprint: "abc123",
  };
  const result = decision(guard);
  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("fingerprint_unchanged");
});

test("denies when continuation count exhausted", () => {
  const guard: GuardState = {
    continuationCount: 1,
    lastFingerprint: null,
    inFlight: false,
    currentFingerprint: "abc123",
  };
  const result = decision(guard);
  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("continuation_exhausted");
});

test("allows when fingerprint changed but count was already 1 and lastFingerprint differs", () => {
  // Edge: if lastFingerprint is different, it's a new set of todos,
  // so we allow (though count guard will stop at 1 next time)
  const guard: GuardState = {
    continuationCount: 0,
    lastFingerprint: "old-fp",
    inFlight: false,
    currentFingerprint: "new-fp",
  };
  const result = decision(guard);
  expect(result.allowed).toBe(true);
});

// ---------------------------------------------------------------------------
// ContinuationStateStore
// ---------------------------------------------------------------------------

let store: ContinuationStateStore;

beforeEach(() => {
  store = new ContinuationStateStore();
});

test("get creates default state for unknown session", () => {
  const state = store.get("session-42");
  expect(state.sessionId).toBe("session-42");
  expect(state.continuationCount).toBe(0);
  expect(state.lastFingerprint).toBeNull();
  expect(state.inFlight).toBe(false);
});

test("reserve sets inFlight, bumps count, records fingerprint", () => {
  store.reserve("s1", "fp1");
  const state = store.get("s1");
  expect(state.inFlight).toBe(true);
  expect(state.continuationCount).toBe(1);
  expect(state.lastFingerprint).toBe("fp1");
});

test("reserve called twice bumps count to 2", () => {
  store.reserve("s1", "fp1");
  store.reserve("s1", "fp2");
  expect(store.get("s1").continuationCount).toBe(2);
  expect(store.get("s1").lastFingerprint).toBe("fp2");
});

test("clearInFlight resets inFlight to false", () => {
  store.reserve("s1", "fp1");
  store.clearInFlight("s1");
  expect(store.get("s1").inFlight).toBe(false);
});

test("failClosed clears inFlight but keeps fingerprint and count", () => {
  store.reserve("s1", "fp1");
  store.failClosed("s1");
  const state = store.get("s1");
  expect(state.inFlight).toBe(false);
  expect(state.continuationCount).toBe(1);
  expect(state.lastFingerprint).toBe("fp1");
});

test("failClosed called twice does not double-count", () => {
  store.reserve("s1", "fp1");
  store.failClosed("s1");
  store.failClosed("s1");
  expect(store.get("s1").continuationCount).toBe(1);
  expect(store.get("s1").inFlight).toBe(false);
});

test("reset removes session state", () => {
  store.reserve("s1", "fp1");
  store.reset("s1");
  const state = store.get("s1");
  expect(state.continuationCount).toBe(0);
  expect(state.inFlight).toBe(false);
  expect(state.lastFingerprint).toBeNull();
});

// ---------------------------------------------------------------------------
// Integration-style: full guard round-trip
// ---------------------------------------------------------------------------

test("full round-trip: filter -> fingerprint -> decision", () => {
  const todos: Todo[] = [
    baseTodo({ id: "a", status: "pending", content: "Alpha" }),
    baseTodo({ id: "b", status: "completed" }),
    baseTodo({ id: "c", status: "in_progress", content: "Beta" }),
  ];

  const actionable = actionableTodoFilter(todos);
  const fp = fingerprint(actionable);

  const guard: GuardState = {
    continuationCount: 0,
    lastFingerprint: null,
    inFlight: false,
    currentFingerprint: fp,
  };

  const result = decision(guard);
  expect(result.allowed).toBe(true);
});

test("no actionable todos round-trip returns denied", () => {
  const todos: Todo[] = [
    baseTodo({ status: "completed" }),
    baseTodo({ status: "cancelled" }),
  ];

  const actionable = actionableTodoFilter(todos);
  const fp = fingerprint(actionable);

  const guard: GuardState = {
    continuationCount: 0,
    lastFingerprint: null,
    inFlight: false,
    currentFingerprint: fp,
  };

  const result = decision(guard);
  expect(result.allowed).toBe(false);
  expect(result.reason).toBe("no_actionable_todos");
});

// ---------------------------------------------------------------------------
// Type exports are accessible
// ---------------------------------------------------------------------------

test("ActionableTodo type is exported", () => {
  // Compile-time check: ActionableTodo should be Assignable to Todo
  const t: ActionableTodo = baseTodo({ status: "pending" });
  expect(t.status).toBe("pending");
});
