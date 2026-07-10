export type Subject =
  | { kind: "strategy"; id: string }
  | { kind: "session"; date: string }
  | { kind: "system"; sinceHours: number };

export type EvidenceFact = { source: string; id: string; data: Record<string, unknown> };
export type EvidencePack = { subject: Subject; facts: EvidenceFact[]; note?: string };
export type GroundedAnswer = { answer: string; citations: string[]; evidencePack: EvidencePack };
