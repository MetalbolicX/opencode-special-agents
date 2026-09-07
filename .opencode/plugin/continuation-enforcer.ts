/**
 * Continuation enforcer plugin
 *
 * React to `session.idle`, fetch actionable todos, and issue at most one
 * non-blocking continuation prompt per session. Guards: in-flight, unchanged
 * fingerprint, and continuation cap. Fails closed on API errors.
 *
 * Enabled by installer DEFAULT: the installer places this artifact at
 * .opencode/plugin/continuation-enforcer.js with --plugin on (the default).
 * Use --plugin off during install to skip the plugin. Removing the installed
 * plugin/continuation-enforcer.js file disables the feature. State is in-memory
 * and session-local; restart resets all continuation state.
 */

import type { Plugin } from "@opencode-ai/plugin";
import {
  actionableTodoFilter,
  fingerprint,
  decision,
  type GuardState,
} from "../lib/continuation-state.ts";
import { ContinuationStateStore } from "../lib/continuation-state.ts";

// ---------------------------------------------------------------------------
// Module-level state — one store per plugin instance (process lifetime)
// ---------------------------------------------------------------------------

const stateStore = new ContinuationStateStore();

/**
 * Maps sessionID → promise that resolves when the synthetic turn idle fires.
 * Used to detect the idle event that follows our own queued prompt and clear
 * the in-flight flag without queueing again.
 */
const inFlightPromises = new Map<string, () => void>();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** True when we are already tracking an in-flight continuation for this session */
const isInFlight = (sessionId: string): boolean => {
  return stateStore.get(sessionId).inFlight;
}

/**
 * Check the in-flight promise map and resolve+clear if present.
 * Returns true if this idle event was the synthetic continuation result.
 */
const resolveInFlight = (sessionId: string): boolean => {
  const resolve = inFlightPromises.get(sessionId);
  if (resolve !== undefined) {
    resolve();
    inFlightPromises.delete(sessionId);
    stateStore.clearInFlight(sessionId);
    return true;
  }
  return false;
}

const waitForSyntheticIdle = async (sessionId: string): Promise<void> => {
  return new Promise<void>((resolve) => {
    inFlightPromises.set(sessionId, resolve);
  });
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

const plugin: Plugin = {
  name: "continuation-enforcer",

  event: async ({ event, client }) => {
    if (event.type !== "session.idle") return;

    const sessionId = event.properties?.sessionID;
    if (!sessionId) return;

    // Step 1: If the in-flight flag is set, this idle follows our own queued
    // prompt. Clear the flag and return without queueing another.
    if (isInFlight(sessionId)) {
      await waitForSyntheticIdle(sessionId);
      return;
    }

    // Step 2: Fetch todos for this session
    const todoResponse = await client.session.todo({ path: { id: sessionId } });

    // Fail closed on error or missing data
    if (todoResponse.error || !todoResponse.data) {
      return;
    }

    const todos = todoResponse.data;
    const actionable = actionableTodoFilter(todos);
    const fp = fingerprint(actionable);

    // Step 3: Evaluate the guard decision
    const sessionState = stateStore.get(sessionId);
    const guard: GuardState = {
      continuationCount: sessionState.continuationCount,
      lastFingerprint: sessionState.lastFingerprint,
      inFlight: sessionState.inFlight,
      currentFingerprint: fp,
    };

    const result = decision(guard);

    if (!result.allowed) {
      return;
    }

    // Step 4: Reserve state BEFORE calling promptAsync
    stateStore.reserve(sessionId, fp);

    // Build a neutral continuation message
    const continuationText =
      actionable.length === 1
        ? `Resume: you have one pending todo — "${actionable[0].content}". Continue working on it if it is still relevant, otherwise update its status and stop.`
        : `Resume: you have ${actionable.length} pending todos. Continue working on the most important one if any remain relevant, otherwise update statuses and stop.`;

    // Step 5: Queue the non-blocking continuation prompt
    const promptResponse = await client.session.promptAsync({
      path: { sessionID: sessionId },
      body: { parts: [{ type: "text", text: continuationText }] },
    });

    // On prompt failure, fail closed: clear in-flight but keep fingerprint/count
    if (promptResponse.error) {
      stateStore.failClosed(sessionId);
      return;
    }

    // Wait for the synthetic idle to fire, then clear in-flight naturally.
    // The wait is fire-and-forget; if it never resolves (e.g. session ends),
    // the inFlight flag stays set until the session is garbage-collected.
    waitForSyntheticIdle(sessionId).catch(() => {
      // ignore — session likely ended
      inFlightPromises.delete(sessionId);
      stateStore.clearInFlight(sessionId);
    });
  },
};

export default plugin;
