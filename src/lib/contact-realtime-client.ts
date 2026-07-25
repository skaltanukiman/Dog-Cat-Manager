export type ContactRealtimeDecision = "invalid" | "stale" | "self" | "remote";

export function decideContactRealtimeChange({
  currentRevision,
  nextRevision,
  actorClientId,
  currentClientId
}: {
  currentRevision: string | null;
  nextRevision: string;
  actorClientId: string | null;
  currentClientId: string;
}): ContactRealtimeDecision {
  if (!/^\d+$/.test(nextRevision)) return "invalid";
  if (currentRevision && BigInt(nextRevision) <= BigInt(currentRevision)) return "stale";
  return actorClientId === currentClientId ? "self" : "remote";
}
