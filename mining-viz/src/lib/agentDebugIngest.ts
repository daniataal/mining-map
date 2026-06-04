/** Cursor agent debug ingest — localhost + opt-in only; no-op on remote dev hosts (e.g. VM public IP). */

const INGEST_URL =
  'http://127.0.0.1:7847/ingest/4a545e2b-07f1-4d20-ade6-14997117a3cb';

export function isLocalDevHost(): boolean {
  if (typeof window === 'undefined') return false;
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '[::1]';
}

/** Enable with VITE_AGENT_DEBUG_INGEST=1 while serving from localhost (Cursor debug session). */
export function isAgentDebugIngestEnabled(): boolean {
  return import.meta.env.VITE_AGENT_DEBUG_INGEST === '1' && isLocalDevHost();
}

export type AgentDebugPayload = {
  sessionId?: string;
  hypothesisId?: string;
  location: string;
  message: string;
  data?: Record<string, unknown>;
  timestamp?: number;
};

export function postAgentDebugIngest(payload: AgentDebugPayload): void {
  if (!isAgentDebugIngestEnabled()) return;
  const sessionId = payload.sessionId ?? '7419a2';
  fetch(INGEST_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Debug-Session-Id': sessionId },
    body: JSON.stringify({
      sessionId,
      timestamp: payload.timestamp ?? Date.now(),
      ...payload,
    }),
  }).catch(() => {});
}

/** DEV console.debug helpers — only on localhost, not on remote VM origins. */
export function isLocalDevConsoleDebugEnabled(): boolean {
  return import.meta.env.DEV && isLocalDevHost();
}
