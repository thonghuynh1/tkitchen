export interface Disposition {
  eventId: string;
  thread: string;
  consumer: string;
  filtered: boolean;
  outcome: string;
  outcomeEventId: string | null;
  ruleId: string;
  policyVersion: number;
  handbacks: string[];
  at: string;
  meta: { behindBy: number };
}
