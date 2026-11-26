export interface BoardModelState {
  cardState: "none" | "active" | "archived";
  inviteVersion: number;
  inviteActive: boolean;
  aliceMember: boolean;
  aliceStream: boolean;
  aliceLinkVersion: number;
  aliceKickedAt: number;
  charlieMember: boolean;
  charlieStream: boolean;
  msgSeq: number;
  aliceSeenSeq: number;
  aliceRemovedAtSeq: number;
  aliceSawPostRemovalMsg: boolean;
  rejoinedWithOldLink: boolean;
  mutatedWhileArchived: boolean;
}

export type BoardInvariantCode = "INV-001" | "INV-002" | "INV-003" | "INV-004" | "PRG-001";

export interface BoardViolation {
  invariantId: BoardInvariantCode;
  stepIndex: number;
  action: string;
  detail: string;
}

export interface BoardInvariantContext {
  state: BoardModelState;
  nonOwnerCreatedCard: boolean;
  archivedHasActiveInvite: boolean;
  archivedHasNonOwnerMember: boolean;
  archivedHasOpenStream: boolean;
  prg001CatchUpReachable: boolean;
}

export function checkBoardInvariants(ctx: BoardInvariantContext, stepIndex: number, action: string): BoardViolation[] {
  const { state } = ctx;
  const violations: BoardViolation[] = [];

  const inv001Ok =
    !ctx.nonOwnerCreatedCard &&
    (!state.aliceStream || state.aliceMember) &&
    (!state.charlieStream || state.charlieMember);
  if (!inv001Ok) {
    violations.push({
      invariantId: "INV-001",
      stepIndex,
      action,
      detail:
        "nonOwnerCreatedCard=" +
        String(ctx.nonOwnerCreatedCard) +
        " aliceStream=" +
        String(state.aliceStream) +
        " aliceMember=" +
        String(state.aliceMember) +
        " charlieStream=" +
        String(state.charlieStream) +
        " charlieMember=" +
        String(state.charlieMember),
    });
  }

  if (state.rejoinedWithOldLink) {
    violations.push({
      invariantId: "INV-002",
      stepIndex,
      action,
      detail: "aliceLinkVersion=" + String(state.aliceLinkVersion) + " aliceKickedAt=" + String(state.aliceKickedAt),
    });
  }

  const inv003Ok =
    !state.aliceSawPostRemovalMsg &&
    (state.aliceMember || state.aliceRemovedAtSeq === 0 || state.aliceSeenSeq <= state.aliceRemovedAtSeq);
  if (!inv003Ok) {
    violations.push({
      invariantId: "INV-003",
      stepIndex,
      action,
      detail:
        "aliceSawPostRemovalMsg=" +
        String(state.aliceSawPostRemovalMsg) +
        " aliceMember=" +
        String(state.aliceMember) +
        " aliceSeenSeq=" +
        String(state.aliceSeenSeq) +
        " aliceRemovedAtSeq=" +
        String(state.aliceRemovedAtSeq),
    });
  }

  const inv004Ok =
    state.cardState !== "archived" ||
    (!state.inviteActive &&
      !state.aliceMember &&
      !state.aliceStream &&
      !state.charlieMember &&
      !state.charlieStream &&
      !state.mutatedWhileArchived &&
      !ctx.archivedHasActiveInvite &&
      !ctx.archivedHasNonOwnerMember &&
      !ctx.archivedHasOpenStream);
  if (!inv004Ok) {
    violations.push({
      invariantId: "INV-004",
      stepIndex,
      action,
      detail:
        "inviteActive=" +
        String(state.inviteActive) +
        " aliceMember=" +
        String(state.aliceMember) +
        " aliceStream=" +
        String(state.aliceStream) +
        " charlieMember=" +
        String(state.charlieMember) +
        " charlieStream=" +
        String(state.charlieStream) +
        " mutatedWhileArchived=" +
        String(state.mutatedWhileArchived) +
        " archivedHasActiveInvite=" +
        String(ctx.archivedHasActiveInvite) +
        " archivedHasNonOwnerMember=" +
        String(ctx.archivedHasNonOwnerMember) +
        " archivedHasOpenStream=" +
        String(ctx.archivedHasOpenStream),
    });
  }

  if (isPrg001Pending(state) && !ctx.prg001CatchUpReachable) {
    violations.push({
      invariantId: "PRG-001",
      stepIndex,
      action,
      detail:
        "catch-up unreachable while pending: aliceSeenSeq=" +
        String(state.aliceSeenSeq) +
        " msgSeq=" +
        String(state.msgSeq),
    });
  }

  return violations;
}

export function isPrg001Pending(state: BoardModelState): boolean {
  return state.cardState === "active" && state.aliceMember && state.aliceSeenSeq < state.msgSeq;
}

export function isPrg001Done(state: BoardModelState): boolean {
  return state.cardState !== "active" || !state.aliceMember || state.aliceSeenSeq === state.msgSeq;
}
