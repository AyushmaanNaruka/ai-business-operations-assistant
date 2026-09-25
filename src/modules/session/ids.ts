/**
 * The one shape a conversation (session) id may take when it arrives from the
 * browser (docs/DECISIONS.md D-56). The chat UI mints UUIDs; older sessions also
 * used `default-thread`, `orchestrator-default-session` and assistant-ui's
 * `__LOCALID_...` ids, all of which fit. Anything else (a path, a quote, a
 * megabyte of text) is refused at the route before it reaches storage or a log.
 */
const SESSION_ID = /^[A-Za-z0-9_-]{1,128}$/;

export function isValidSessionId(value: unknown): value is string {
  return typeof value === 'string' && SESSION_ID.test(value);
}
