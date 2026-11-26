import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { CardService } from "../../modules/cards/index.ts";
import type { CardId, InviteToken } from "../../modules/cards/index.ts";
import { ChatService } from "../../modules/chat/index.ts";
import { IdentityService, userIdFromGithub } from "../../modules/identities/index.ts";
import type { Viewer } from "../../modules/identities/index.ts";
import { InMemoryLiveHub } from "../../modules/live/index.ts";
import {
  SimCardStore,
  SimChatStore,
  SimIdentityStore,
  SimOAuthPort,
  SimStreamClient,
} from "../doubles/sim-board-stores.ts";
import { checkBoardInvariants, isPrg001Done, isPrg001Pending } from "../oracles/board-invariants.ts";
import type { BoardInvariantContext, BoardModelState, BoardViolation } from "../oracles/board-invariants.ts";
import { VirtualClock } from "../world/clock.ts";
import { SeededIds, SeededRandom } from "../world/rng.ts";

export type BoardModelAction =
  | "ownerCreateCard"
  | "ownerCreateInvite"
  | "ownerShareLinkWithAlice"
  | "aliceRedeemLink"
  | "charlieJoinViaActiveLink"
  | "aliceOpenStream"
  | "aliceDropStream"
  | "charlieOpenStream"
  | "ownerPostMessage"
  | "aliceCatchUp"
  | "ownerRemoveAlice"
  | "ownerCloseSharing"
  | "ownerArchiveCard";

export interface BoardTraceStep {
  action: BoardModelAction | null;
  state: BoardModelState;
}

export interface FaultCoverage {
  sseDropCatchUp: number;
  duplicateAndConcurrentRedeem: number;
  removeVsPost: number;
  closeSharingVsStaleRedeem: number;
  archiveWithMultipleStreams: number;
  serverRestart: number;
}

export interface BoardSeedRun {
  seed: number;
  stepCount: number;
  finalState: BoardModelState;
  trace: BoardTraceStep[];
  traceHash: string;
  violations: BoardViolation[];
  coverage: FaultCoverage;
}

export interface BoardBatchReport {
  runs: BoardSeedRun[];
  violations: Array<{ seed: number; violation: BoardViolation }>;
  coverage: FaultCoverage;
}

const DEFAULT_SEED_COUNT = 200;
const MAX_STEPS_PER_SEED = 26;
const REDIRECT_URI = "http://localhost:3000/auth/callback";

function emptyCoverage(): FaultCoverage {
  return {
    sseDropCatchUp: 0,
    duplicateAndConcurrentRedeem: 0,
    removeVsPost: 0,
    closeSharingVsStaleRedeem: 0,
    archiveWithMultipleStreams: 0,
    serverRestart: 0,
  };
}

function addCoverage(acc: FaultCoverage, next: FaultCoverage): void {
  acc.sseDropCatchUp += next.sseDropCatchUp;
  acc.duplicateAndConcurrentRedeem += next.duplicateAndConcurrentRedeem;
  acc.removeVsPost += next.removeVsPost;
  acc.closeSharingVsStaleRedeem += next.closeSharingVsStaleRedeem;
  acc.archiveWithMultipleStreams += next.archiveWithMultipleStreams;
  acc.serverRestart += next.serverRestart;
}

async function signInActor(identity: IdentityService, code: string): Promise<Viewer> {
  const start = identity.beginSignIn({ returnTo: "/", redirectUri: REDIRECT_URI });
  const outcome = await identity.completeSignIn({
    code,
    state: start.state,
    expectedState: start.state,
    redirectUri: REDIRECT_URI,
  });
  if (!outcome.ok) throw new Error("sim sign-in failed for " + code);
  const viewer = identity.viewer(outcome.sessionId);
  if (viewer === null) throw new Error("sim viewer missing for " + code);
  return viewer;
}

function hashTrace(trace: readonly BoardTraceStep[]): string {
  return createHash("sha256").update(JSON.stringify(trace)).digest("hex");
}

function actionWeight(
  action: BoardModelAction,
  state: BoardModelState,
  profile: number,
  stepIndex: number,
  aliceDroppedRecently: boolean,
): number {
  if (profile === 0) {
    if (action === "ownerArchiveCard" || action === "ownerCloseSharing" || action === "ownerRemoveAlice") return 1;
    if (action === "ownerPostMessage") return aliceDroppedRecently ? 10 : 1;
    if (action === "aliceOpenStream" || action === "aliceDropStream" || action === "aliceCatchUp") return 10;
    if (action === "ownerCreateInvite" || action === "ownerShareLinkWithAlice" || action === "aliceRedeemLink") {
      return 8;
    }
    return 2;
  }
  if (profile === 1) {
    if (action === "ownerArchiveCard" || action === "ownerCloseSharing" || action === "ownerRemoveAlice") return 1;
    if (
      action === "ownerCreateInvite" ||
      action === "ownerShareLinkWithAlice" ||
      action === "aliceRedeemLink" ||
      action === "charlieJoinViaActiveLink"
    ) {
      return 8;
    }
    return 2;
  }
  if (profile === 2) {
    if (action === "ownerArchiveCard" || action === "ownerCloseSharing") return 1;
    if (
      action === "ownerCreateInvite" ||
      action === "ownerShareLinkWithAlice" ||
      action === "aliceRedeemLink" ||
      action === "ownerRemoveAlice" ||
      action === "ownerPostMessage" ||
      action === "aliceCatchUp"
    ) {
      return 8;
    }
    return 2;
  }
  if (profile === 3) {
    if (action === "ownerArchiveCard") return 1;
    if (
      action === "ownerCreateInvite" ||
      action === "ownerShareLinkWithAlice" ||
      action === "ownerCloseSharing" ||
      action === "aliceRedeemLink"
    ) {
      return 8;
    }
    return 2;
  }
  if (profile === 4) {
    if (state.aliceStream && state.charlieStream) {
      return action === "ownerArchiveCard" ? 16 : 1;
    }
    if (
      action === "ownerArchiveCard" ||
      action === "ownerCloseSharing" ||
      action === "ownerRemoveAlice" ||
      action === "aliceDropStream"
    ) {
      return 1;
    }
    if (
      action === "ownerCreateInvite" ||
      action === "ownerShareLinkWithAlice" ||
      action === "aliceRedeemLink" ||
      action === "charlieJoinViaActiveLink" ||
      action === "aliceOpenStream" ||
      action === "charlieOpenStream"
    ) {
      return 10;
    }
    return 2;
  }
  return action === "ownerArchiveCard" && stepIndex < 10 ? 1 : action === "ownerArchiveCard" ? 2 : 3;
}

function enabledActions(
  state: BoardModelState,
  profile: number,
  stepIndex: number,
  aliceDroppedRecently: boolean,
): BoardModelAction[] {
  const list: BoardModelAction[] = [];
  if (state.cardState === "none") list.push("ownerCreateCard");
  if (state.cardState === "active" && !state.inviteActive && state.inviteVersion < 2) list.push("ownerCreateInvite");
  if (state.cardState === "active" && state.inviteActive && state.aliceLinkVersion < state.inviteVersion) {
    list.push("ownerShareLinkWithAlice");
  }
  if (state.cardState !== "none" && state.aliceLinkVersion > 0 && !state.aliceMember) list.push("aliceRedeemLink");
  if (state.cardState === "active" && state.inviteActive && !state.charlieMember) list.push("charlieJoinViaActiveLink");
  if (state.cardState === "active" && state.aliceMember && !state.aliceStream) list.push("aliceOpenStream");
  if (state.aliceStream) list.push("aliceDropStream");
  if (state.cardState === "active" && state.charlieMember && !state.charlieStream) list.push("charlieOpenStream");
  if (state.cardState === "active" && state.msgSeq < 2) list.push("ownerPostMessage");
  if (state.cardState === "active" && state.aliceSeenSeq < state.msgSeq) list.push("aliceCatchUp");
  if (state.cardState === "active" && state.aliceMember) list.push("ownerRemoveAlice");
  if (state.cardState === "active" && (state.inviteActive || state.aliceMember || state.charlieMember)) {
    list.push("ownerCloseSharing");
  }
  if (state.cardState === "active") list.push("ownerArchiveCard");

  const weighted: BoardModelAction[] = [];
  for (const action of list) {
    const copies = actionWeight(action, state, profile, stepIndex, aliceDroppedRecently);
    for (let i = 0; i < copies; i += 1) weighted.push(action);
  }
  return weighted;
}

export async function runBoardSeed(seed: number): Promise<BoardSeedRun> {
  const rng = new SeededRandom(seed);
  const clock = new VirtualClock();
  const ids = new SeededIds();

  const identityStore = new SimIdentityStore();
  const oauth = new SimOAuthPort();
  const ownerUserId = userIdFromGithub(1001);
  const identityService = new IdentityService({
    store: identityStore,
    oauth,
    clock,
    ids,
    ownerId: ownerUserId,
  });

  const owner = await signInActor(identityService, "code-owner");
  const alice = await signInActor(identityService, "code-alice");
  const charlie = await signInActor(identityService, "code-charlie");
  const stranger = await signInActor(identityService, "code-stranger");

  const cardStore = new SimCardStore();
  const chatStore = new SimChatStore();
  const cardService = new CardService({ store: cardStore, clock, ids });
  const chatService = new ChatService({ store: chatStore, cards: cardStore, clock, ids });
  let liveHub = new InMemoryLiveHub();

  let cardId: CardId | null = null;
  let inviteVersion = 0;
  let aliceLinkVersion = 0;
  let aliceToken: InviteToken | null = null;
  let lastInviteToken: InviteToken | null = null;
  let aliceKickedAt = 0;
  let aliceSeenSeq = 0;
  let aliceRemovedAtSeq = 0;
  let aliceSawPostRemovalMsg = false;
  let rejoinedWithOldLink = false;
  let mutatedWhileArchived = false;
  let nonOwnerCreatedCard = false;

  let aliceClient: SimStreamClient | null = null;
  let charlieClient: SimStreamClient | null = null;

  let aliceDroppedRecently = false;
  let closeSharingExecuted = false;
  let serverRestarted = false;

  const coverage = emptyCoverage();
  const violations: BoardViolation[] = [];

  function currentMsgSeq(): number {
    if (cardId === null) return 0;
    const entries = chatStore.listEntriesAfter(cardId, 0);
    const last = entries[entries.length - 1];
    return last === undefined ? 0 : last.seq;
  }

  function projectState(): BoardModelState {
    if (cardId === null) {
      return {
        cardState: "none",
        inviteVersion,
        inviteActive: false,
        aliceMember: false,
        aliceStream: false,
        aliceLinkVersion,
        aliceKickedAt,
        charlieMember: false,
        charlieStream: false,
        msgSeq: 0,
        aliceSeenSeq,
        aliceRemovedAtSeq,
        aliceSawPostRemovalMsg,
        rejoinedWithOldLink,
        mutatedWhileArchived,
      };
    }
    const card = cardStore.getCard(cardId);
    const cardState: "none" | "active" | "archived" =
      card === null ? "none" : card.archivedAt === null ? "active" : "archived";
    const inviteActive = cardStore.getActiveInvite(cardId) !== null;
    const aliceMember = cardStore.isMember(cardId, alice.user.id);
    const charlieMember = cardStore.isMember(cardId, charlie.user.id);
    const aliceStream = liveHub.connectionCount(alice.user.id) > 0;
    const charlieStream = liveHub.connectionCount(charlie.user.id) > 0;
    return {
      cardState,
      inviteVersion,
      inviteActive,
      aliceMember,
      aliceStream,
      aliceLinkVersion,
      aliceKickedAt,
      charlieMember,
      charlieStream,
      msgSeq: currentMsgSeq(),
      aliceSeenSeq,
      aliceRemovedAtSeq,
      aliceSawPostRemovalMsg,
      rejoinedWithOldLink,
      mutatedWhileArchived,
    };
  }

  function buildContext(state: BoardModelState): BoardInvariantContext {
    let archivedHasActiveInvite = false;
    let archivedHasNonOwnerMember = false;
    let archivedHasOpenStream = false;
    if (cardId !== null && state.cardState === "archived") {
      archivedHasActiveInvite = cardStore.getActiveInvite(cardId) !== null;
      const members = cardStore.listMemberIds(cardId);
      archivedHasNonOwnerMember = members.some((memberId) => memberId !== owner.user.id);
      archivedHasOpenStream = liveHub.connectionCount() > 0;
    }
    return {
      state,
      nonOwnerCreatedCard,
      archivedHasActiveInvite,
      archivedHasNonOwnerMember,
      archivedHasOpenStream,
    };
  }

  function verifyInvariants(stepIndex: number, action: string): BoardModelState {
    const state = projectState();
    const found = checkBoardInvariants(buildContext(state), stepIndex, action);
    for (const item of found) violations.push(item);
    return state;
  }

  function runNonOwnerCreateCardProbe(stepIndex: number): void {
    const actor = rng.nextInt(2) === 0 ? alice : stranger;
    const outcome = cardService.createCard(actor, { title: "Unauthorized card" });
    if (outcome.ok) nonOwnerCreatedCard = true;
    verifyInvariants(stepIndex, "nonOwnerCreateCardProbe");
  }

  function runDuplicateRedeemProbe(stepIndex: number): void {
    const state = projectState();
    if (
      cardId === null ||
      state.cardState !== "active" ||
      !state.inviteActive ||
      !state.aliceMember ||
      aliceToken === null ||
      aliceLinkVersion !== inviteVersion
    ) {
      return;
    }
    const outcome = cardService.redeemInvite(alice, { token: aliceToken });
    if (!outcome.ok) {
      violations.push({
        invariantId: "INV-002",
        stepIndex,
        action: "duplicateRedeemProbe",
        detail: "expected idempotent duplicate redeem to succeed",
      });
    }
    const members = cardStore.listMemberIds(cardId);
    if (new Set(members).size !== members.length) {
      violations.push({
        invariantId: "INV-001",
        stepIndex,
        action: "duplicateRedeemProbe",
        detail: "duplicate member ids recorded after repeat redeem",
      });
    }
    coverage.duplicateAndConcurrentRedeem += 1;
    verifyInvariants(stepIndex, "duplicateRedeemProbe");
  }

  function runArchivedMutationProbe(stepIndex: number): void {
    if (cardId === null) return;
    const moved = cardService.moveCard(owner, { cardId, column: "doing" });
    const invited = cardService.getOrCreateInvite(owner, { cardId });
    const redeemed =
      lastInviteToken === null
        ? { ok: false as const, reason: "gone" as const }
        : cardService.redeemInvite(alice, { token: lastInviteToken });
    const posted = chatService.postEntry(owner, { cardId, text: "After archive", replyToId: null });
    const listed = chatService.listEntries(owner, { cardId, afterSeq: 0 });
    if (moved.ok || invited.ok || redeemed.ok || posted.ok || listed.ok) {
      mutatedWhileArchived = true;
    }
    verifyInvariants(stepIndex, "archivedMutationProbe");
  }

  function runServerRestartFault(stepIndex: number, trace: BoardTraceStep[]): boolean {
    const before = projectState();
    if (before.charlieStream) return false;
    const aliceHadStream = before.aliceStream;
    liveHub.closeAll();
    liveHub = new InMemoryLiveHub();
    aliceClient = null;
    charlieClient = null;
    serverRestarted = true;
    if (aliceHadStream) aliceDroppedRecently = true;
    coverage.serverRestart += 1;
    const after = verifyInvariants(stepIndex, "serverRestartFault");
    if (aliceHadStream) {
      trace.push({ action: "aliceDropStream", state: after });
      return true;
    }
    return false;
  }

  function executeModelAction(action: BoardModelAction): void {
    clock.advance(1000);
    switch (action) {
      case "ownerCreateCard": {
        const outcome = cardService.createCard(owner, { title: "Board card" });
        if (!outcome.ok) throw new Error("ownerCreateCard failed: " + outcome.reason);
        cardId = outcome.card.id;
        return;
      }
      case "ownerCreateInvite": {
        if (cardId === null) throw new Error("cardId missing");
        const outcome = cardService.getOrCreateInvite(owner, { cardId });
        if (!outcome.ok) throw new Error("ownerCreateInvite failed: " + outcome.reason);
        inviteVersion += 1;
        lastInviteToken = outcome.invite.token;
        return;
      }
      case "ownerShareLinkWithAlice": {
        if (cardId === null) throw new Error("cardId missing");
        const active = cardStore.getActiveInvite(cardId);
        if (active === null) throw new Error("active invite missing");
        aliceToken = active.token;
        aliceLinkVersion = inviteVersion;
        return;
      }
      case "aliceRedeemLink": {
        if (aliceToken === null) throw new Error("aliceToken missing");
        const outcome = cardService.redeemInvite(alice, { token: aliceToken });
        if (outcome.ok) {
          aliceRemovedAtSeq = 0;
          if (aliceLinkVersion <= aliceKickedAt) {
            rejoinedWithOldLink = true;
          }
          return;
        }
        if (closeSharingExecuted) coverage.closeSharingVsStaleRedeem += 1;
        if (serverRestarted) coverage.serverRestart += 1;
        return;
      }
      case "charlieJoinViaActiveLink": {
        if (cardId === null) throw new Error("cardId missing");
        const active = cardStore.getActiveInvite(cardId);
        if (active === null) throw new Error("active invite missing for charlie");
        const aliceWasMember = cardStore.isMember(cardId, alice.user.id);
        const outcome = cardService.redeemInvite(charlie, { token: active.token });
        if (!outcome.ok) throw new Error("charlieJoinViaActiveLink failed");
        if (aliceWasMember) coverage.duplicateAndConcurrentRedeem += 1;
        return;
      }
      case "aliceOpenStream": {
        if (cardId === null) throw new Error("cardId missing");
        if (!cardService.isMember(cardId, alice.user.id)) return;
        const client = new SimStreamClient();
        const unregister = liveHub.register(alice.user.id, client);
        client.attachUnregister(unregister);
        aliceClient = client;
        return;
      }
      case "aliceDropStream": {
        if (aliceClient !== null) {
          aliceClient.drop();
          aliceClient = null;
          aliceDroppedRecently = true;
        }
        return;
      }
      case "charlieOpenStream": {
        if (cardId === null) throw new Error("cardId missing");
        if (!cardService.isMember(cardId, charlie.user.id)) return;
        const client = new SimStreamClient();
        const unregister = liveHub.register(charlie.user.id, client);
        client.attachUnregister(unregister);
        charlieClient = client;
        return;
      }
      case "ownerPostMessage": {
        if (cardId === null) throw new Error("cardId missing");
        const prevMaxSeq = aliceClient?.maxReceivedSeq ?? 0;
        const nextSeq = currentMsgSeq() + 1;
        const outcome = chatService.postEntry(owner, {
          cardId,
          text: "Note " + String(nextSeq),
          replyToId: null,
        });
        if (!outcome.ok) throw new Error("ownerPostMessage failed: " + outcome.reason);
        const memberIds = cardService.listMemberIds(cardId);
        liveHub.broadcast(memberIds, "message_created", {
          message: { seq: outcome.entry.seq, cardId: outcome.entry.cardId },
        });
        if (aliceClient !== null && aliceClient.maxReceivedSeq > prevMaxSeq) {
          aliceSeenSeq = Math.max(aliceSeenSeq, aliceClient.maxReceivedSeq);
          if (!cardStore.isMember(cardId, alice.user.id)) {
            aliceSawPostRemovalMsg = true;
          }
        }
        return;
      }
      case "aliceCatchUp": {
        if (cardId === null) throw new Error("cardId missing");
        const outcome = chatService.listEntries(alice, { cardId, afterSeq: aliceSeenSeq });
        if (outcome.ok) {
          const isMemberNow = cardStore.isMember(cardId, alice.user.id);
          for (const entry of outcome.entries) {
            if (entry.seq > aliceSeenSeq) aliceSeenSeq = entry.seq;
            if (!isMemberNow && entry.seq > aliceRemovedAtSeq) {
              aliceSawPostRemovalMsg = true;
            }
          }
          if (aliceDroppedRecently) {
            coverage.sseDropCatchUp += 1;
            aliceDroppedRecently = false;
          }
          if (serverRestarted) coverage.serverRestart += 1;
          return;
        }
        if (aliceRemovedAtSeq > 0 || aliceKickedAt > 0) {
          coverage.removeVsPost += 1;
        }
        return;
      }
      case "ownerRemoveAlice": {
        if (cardId === null) throw new Error("cardId missing");
        const seqBefore = currentMsgSeq();
        const outcome = cardService.removeMember(owner, { cardId, memberId: alice.user.id });
        if (!outcome.ok) throw new Error("ownerRemoveAlice failed: " + outcome.reason);
        liveHub.revokeCardAccess(cardId, outcome.removedUserIds);
        if (aliceClient !== null && !aliceClient.open) aliceClient = null;
        aliceKickedAt = inviteVersion;
        aliceRemovedAtSeq = seqBefore;
        return;
      }
      case "ownerCloseSharing": {
        if (cardId === null) throw new Error("cardId missing");
        const aliceWasMember = cardStore.isMember(cardId, alice.user.id);
        const seqBefore = currentMsgSeq();
        const outcome = cardService.closeSharing(owner, { cardId });
        if (!outcome.ok) throw new Error("ownerCloseSharing failed: " + outcome.reason);
        liveHub.revokeCardAccess(cardId, outcome.removedUserIds);
        if (aliceClient !== null && !aliceClient.open) aliceClient = null;
        if (charlieClient !== null && !charlieClient.open) charlieClient = null;
        closeSharingExecuted = true;
        if (aliceWasMember) {
          aliceKickedAt = inviteVersion;
          aliceRemovedAtSeq = seqBefore;
        }
        return;
      }
      case "ownerArchiveCard": {
        if (cardId === null) throw new Error("cardId missing");
        const before = projectState();
        const bothStreamsOpen = before.aliceStream && before.charlieStream;
        const aliceWasMember = before.aliceMember;
        const seqBefore = currentMsgSeq();
        const outcome = cardService.archiveCard(owner, { cardId });
        if (!outcome.ok) throw new Error("ownerArchiveCard failed: " + outcome.reason);
        liveHub.revokeCardAccess(cardId, outcome.removedUserIds);
        if (aliceClient !== null && !aliceClient.open) aliceClient = null;
        if (charlieClient !== null && !charlieClient.open) charlieClient = null;
        if (bothStreamsOpen) coverage.archiveWithMultipleStreams += 1;
        if (aliceWasMember) {
          aliceKickedAt = inviteVersion;
          aliceRemovedAtSeq = seqBefore;
        }
        return;
      }
    }
  }

  const initialState = verifyInvariants(0, "init");
  const trace: BoardTraceStep[] = [{ action: null, state: initialState }];
  const profile = (((seed - 1) % 6) + 6) % 6;

  let stepIndex = 0;
  for (let round = 0; round < MAX_STEPS_PER_SEED; round += 1) {
    const current = projectState();
    if (current.cardState === "archived") {
      runArchivedMutationProbe(stepIndex);
      if (current.aliceLinkVersion > 0 && !current.aliceMember && rng.nextInt(2) === 0) {
        stepIndex += 1;
        executeModelAction("aliceRedeemLink");
        const afterRedeem = verifyInvariants(stepIndex, "aliceRedeemLink");
        trace.push({ action: "aliceRedeemLink", state: afterRedeem });
      }
      break;
    }

    const roll = rng.nextInt(12);
    if (roll === 0) {
      runNonOwnerCreateCardProbe(stepIndex);
    } else if (roll === 1) {
      runDuplicateRedeemProbe(stepIndex);
    } else if (roll === 2 && current.cardState === "active") {
      const emitted = runServerRestartFault(stepIndex + 1, trace);
      if (emitted) {
        stepIndex += 1;
        continue;
      }
    }

    const candidates = enabledActions(projectState(), profile, stepIndex, aliceDroppedRecently);
    if (candidates.length === 0) break;
    const chosen = rng.pick(candidates);
    stepIndex += 1;
    executeModelAction(chosen);
    const after = verifyInvariants(stepIndex, chosen);
    trace.push({ action: chosen, state: after });
  }

  const beforeFinal = projectState();
  if (isPrg001Pending(beforeFinal)) {
    stepIndex += 1;
    executeModelAction("aliceCatchUp");
    const afterCatchUp = verifyInvariants(stepIndex, "aliceCatchUp");
    trace.push({ action: "aliceCatchUp", state: afterCatchUp });
    if (!isPrg001Done(afterCatchUp)) {
      violations.push({
        invariantId: "PRG-001",
        stepIndex,
        action: "aliceCatchUp",
        detail: "aliceSeenSeq=" + String(afterCatchUp.aliceSeenSeq) + " msgSeq=" + String(afterCatchUp.msgSeq),
      });
    }
  }

  const finalState = projectState();
  return {
    seed,
    stepCount: trace.length - 1,
    finalState,
    trace,
    traceHash: hashTrace(trace),
    violations,
    coverage,
  };
}

export async function runBoardBatch(seeds: readonly number[]): Promise<BoardBatchReport> {
  const runs: BoardSeedRun[] = [];
  const violations: Array<{ seed: number; violation: BoardViolation }> = [];
  const coverage = emptyCoverage();
  for (const seed of seeds) {
    const run = await runBoardSeed(seed);
    runs.push(run);
    addCoverage(coverage, run.coverage);
    for (const violation of run.violations) {
      violations.push({ seed, violation });
    }
  }
  return { runs, violations, coverage };
}

export function boardSeedsFromEnv(): number[] {
  const single = process.env["DST_SEED"];
  if (single !== undefined && single.trim() !== "") {
    const parsed = Number.parseInt(single.trim(), 10);
    if (!Number.isFinite(parsed)) throw new Error("invalid DST_SEED: " + single);
    return [parsed];
  }
  const rawCount = process.env["DST_SEEDS"];
  const count =
    rawCount !== undefined && rawCount.trim() !== "" ? Number.parseInt(rawCount.trim(), 10) : DEFAULT_SEED_COUNT;
  if (!Number.isFinite(count) || count <= 0) throw new Error("invalid DST_SEEDS: " + String(rawCount));
  const seeds: number[] = [];
  for (let i = 1; i <= count; i += 1) seeds.push(i);
  return seeds;
}

export function formatBoardSeedFailure(run: BoardSeedRun): string {
  const lines = ["DST_SEED=" + String(run.seed) + " failed (" + String(run.violations.length) + " violations)"];
  for (const v of run.violations) {
    lines.push("  step=" + String(v.stepIndex) + " [" + v.invariantId + "] " + v.action + ": " + v.detail);
  }
  return lines.join("\n");
}

export function writeBoardTraceJsonl(filePath: string, trace: readonly BoardTraceStep[]): void {
  mkdirSync(dirname(filePath), { recursive: true });
  const content = trace.map((step) => JSON.stringify(step)).join("\n") + "\n";
  writeFileSync(filePath, content, "utf8");
}
