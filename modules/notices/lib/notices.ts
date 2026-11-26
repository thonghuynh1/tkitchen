import type { Store, Trigger, Disposition } from "../../triggers/index.ts";
import { isOpenStatus, noticeFromState } from "./notice.ts";
import type { Notice } from "./notice.ts";

export interface NoticesResult {
  notices: Notice[];
  rounds: { repo: string; lastCompleteAt: string | null; lastError: string | null }[];
  configPath: string | null;
}
export function getNotices(store: Store, configPath: string | null = null): NoticesResult {
  const notices = store
    .listBranchStates()
    .filter((s) => isOpenStatus(s.status))
    .map(noticeFromState);
  return { notices, rounds: store.listRoundStatus(), configPath };
}
export function formatNotices(result: NoticesResult): string {
  return result.notices
    .map((n) => {
      const head =
        n.repo +
        " " +
        n.branch +
        " " +
        n.status +
        (n.base !== null ? " base=" + n.base : "") +
        (n.behindBy !== null ? " behindBy=" + n.behindBy : "");
      if (n.status === "needs_base") {
        const hint = 'add "bases": { "' + n.branch + '": "<base>" }';
        return head + " " + hint + (result.configPath !== null ? " to " + result.configPath : "");
      }
      if (n.status === "ambiguous") return head + " reason=" + (n.evidence ?? "unknown");
      return head;
    })
    .join("\n");
}

export interface HistoryEntry {
  event: Trigger;
  dispositions: Disposition[];
}
export interface HistoryResult {
  history: HistoryEntry[];
}
export function getHistory(store: Store): HistoryResult {
  const dispositions = store.listDispositions();
  const byEvent = new Map<string, Disposition[]>();
  for (const d of dispositions) {
    const arr = byEvent.get(d.eventId) ?? [];
    arr.push(d);
    byEvent.set(d.eventId, arr);
  }
  const triggers = store.listTriggers();
  const history = [...triggers].reverse().map((event) => ({ event, dispositions: byEvent.get(event.id) ?? [] }));
  return { history };
}
export function formatHistory(result: HistoryResult): string {
  const lines: string[] = [];
  for (const { event, dispositions } of result.history) {
    lines.push(event.id + " " + event.source + " base=" + event.meta.base + " at=" + event.at);
    for (const d of dispositions) lines.push("  " + d.thread + " " + d.outcome + " behindBy=" + d.meta.behindBy);
  }
  return lines.join("\n");
}
