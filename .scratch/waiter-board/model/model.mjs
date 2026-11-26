export default {
  name: "waiter-board-slice-1",
  description: "Bounded model of card ownership, multi-use invites, individual kick, close-sharing, soft-delete/archive, live SSE delivery, and reconnect catch-up",
  bounds: { maxStates: 8000, maxDepth: 16, maxGraphStates: 200 },

  init: () => ({
    cardState: "none", // "none" | "active" | "archived"
    inviteVersion: 0, // 0 = never created, 1..2 = token version
    inviteActive: false,
    aliceMember: false,
    aliceStream: false,
    aliceLinkVersion: 0,
    aliceKickedAt: 0,
    charlieMember: false,
    charlieStream: false,
    msgSeq: 0, // 0..2 messages posted on card
    aliceSeenSeq: 0,
    aliceRemovedAtSeq: 0,
    aliceSawPostRemovalMsg: false,
    rejoinedWithOldLink: false,
    mutatedWhileArchived: false,
  }),

  actions: {
    ownerCreateCard: {
      label: "owner creates card",
      guard: (s) => s.cardState === "none",
      step: (s) => ({ ...s, cardState: "active" }),
    },
    ownerCreateInvite: {
      label: "owner creates/rotates invite link",
      guard: (s) => s.cardState === "active" && !s.inviteActive && s.inviteVersion < 2,
      step: (s) => ({
        ...s,
        inviteVersion: s.inviteVersion + 1,
        inviteActive: true,
      }),
    },
    ownerShareLinkWithAlice: {
      label: "owner sends current invite link to Alice",
      guard: (s) => s.cardState === "active" && s.inviteActive && s.aliceLinkVersion < s.inviteVersion,
      step: (s) => ({ ...s, aliceLinkVersion: s.inviteVersion }),
    },
    aliceRedeemLink: {
      label: "Alice opens her invite link",
      guard: (s) => s.cardState !== "none" && s.aliceLinkVersion > 0 && !s.aliceMember,
      step: (s) => {
        if (s.cardState === "active" && s.inviteActive && s.aliceLinkVersion === s.inviteVersion) {
          return {
            ...s,
            aliceMember: true,
            aliceRemovedAtSeq: 0,
            rejoinedWithOldLink: s.aliceLinkVersion <= s.aliceKickedAt ? true : s.rejoinedWithOldLink,
          };
        }
        return s; // rejected (410)
      },
    },
    charlieJoinViaActiveLink: {
      label: "Charlie joins via current active invite link",
      guard: (s) => s.cardState === "active" && s.inviteActive && !s.charlieMember,
      step: (s) => ({ ...s, charlieMember: true }),
    },
    aliceOpenStream: {
      label: "Alice opens live SSE stream",
      guard: (s) => s.cardState === "active" && s.aliceMember && !s.aliceStream,
      step: (s) => ({ ...s, aliceStream: true }),
    },
    aliceDropStream: {
      label: "Alice Wi-Fi drops (SSE stream disconnects)",
      guard: (s) => s.aliceStream,
      step: (s) => ({ ...s, aliceStream: false }),
    },
    charlieOpenStream: {
      label: "Charlie opens live SSE stream",
      guard: (s) => s.cardState === "active" && s.charlieMember && !s.charlieStream,
      step: (s) => ({ ...s, charlieStream: true }),
    },
    ownerPostMessage: {
      label: "owner posts a chat message (broadcast to active member SSE streams)",
      guard: (s) => s.cardState === "active" && s.msgSeq < 2,
      step: (s) => {
        const nextSeq = s.msgSeq + 1;
        const deliveredToAlice = s.aliceMember && s.aliceStream;
        return {
          ...s,
          msgSeq: nextSeq,
          aliceSeenSeq: deliveredToAlice ? nextSeq : s.aliceSeenSeq,
          aliceSawPostRemovalMsg:
            !s.aliceMember && deliveredToAlice ? true : s.aliceSawPostRemovalMsg,
        };
      },
    },
    aliceCatchUp: {
      label: "Alice reconnects and fetches ?after=lastSeq",
      guard: (s) => s.cardState === "active" && s.aliceSeenSeq < s.msgSeq,
      step: (s) => {
        if (!s.aliceMember) return s; // 403 Forbidden
        return { ...s, aliceSeenSeq: s.msgSeq };
      },
    },
    ownerRemoveAlice: {
      label: "owner removes Alice (closes her stream + revokes active invite)",
      guard: (s) => s.cardState === "active" && s.aliceMember,
      step: (s) => ({
        ...s,
        aliceMember: false,
        aliceStream: false,
        inviteActive: false,
        aliceKickedAt: s.inviteVersion,
        aliceRemovedAtSeq: s.msgSeq,
      }),
    },
    ownerCloseSharing: {
      label: "owner clicks Close sharing (kicks all non-owners + closes all streams + revokes invite)",
      guard: (s) => s.cardState === "active" && (s.inviteActive || s.aliceMember || s.charlieMember),
      step: (s) => ({
        ...s,
        inviteActive: false,
        aliceMember: false,
        aliceStream: false,
        charlieMember: false,
        charlieStream: false,
        aliceKickedAt: s.aliceMember ? s.inviteVersion : s.aliceKickedAt,
        aliceRemovedAtSeq: s.aliceMember ? s.msgSeq : s.aliceRemovedAtSeq,
      }),
    },
    ownerArchiveCard: {
      label: "owner soft-deletes (archives) card (revokes invite + closes all streams)",
      guard: (s) => s.cardState === "active",
      step: (s) => ({
        ...s,
        cardState: "archived",
        inviteActive: false,
        aliceMember: false,
        aliceStream: false,
        charlieMember: false,
        charlieStream: false,
        aliceKickedAt: s.aliceMember ? s.inviteVersion : s.aliceKickedAt,
        aliceRemovedAtSeq: s.aliceMember ? s.msgSeq : s.aliceRemovedAtSeq,
      }),
    },
  },

  invariants: {
    "INV-001": {
      rule: "Only the host owner may create cards; non-members may never hold an open live stream for a card",
      harm: "Removed or unauthorized users keep receiving live chat events",
      check: (s) => (!s.aliceStream || s.aliceMember) && (!s.charlieStream || s.charlieMember),
    },
    "INV-002": {
      rule: "A removed member can never rejoin using an invite link created before or at their removal",
      harm: "Kicked user clicks their old invite link and immediately re-enters the card",
      check: (s) => !s.rejoinedWithOldLink,
    },
    "INV-003": {
      rule: "A non-member never receives messages posted after removal (neither via SSE nor via catch-up)",
      harm: "Removed user leaks private messages posted after they were kicked",
      check: (s) =>
        !s.aliceSawPostRemovalMsg &&
        (s.aliceMember || s.aliceRemovedAtSeq === 0 || s.aliceSeenSeq <= s.aliceRemovedAtSeq),
    },
    "INV-004": {
      rule: "A soft-deleted (archived) card has no active invite, no non-owner members, and no open live streams",
      harm: "Archived card remains reachable via old invite link or keeps streaming to former members",
      check: (s) =>
        s.cardState !== "archived" ||
        (!s.inviteActive && !s.aliceMember && !s.aliceStream && !s.charlieMember && !s.charlieStream && !s.mutatedWhileArchived),
    },
  },

  progress: {
    "PRG-001": {
      rule: "An active member who missed messages during a disconnect can always catch up (or be removed/archived)",
      harm: "Messages posted during a Wi-Fi drop are permanently lost for an active member",
      pending: (s) => s.cardState === "active" && s.aliceMember && s.aliceSeenSeq < s.msgSeq,
      done: (s) => s.cardState !== "active" || !s.aliceMember || s.aliceSeenSeq === s.msgSeq,
    },
  },

  terminal: (s) => s.cardState === "archived",

  stateLabel: (s) =>
    `card=${s.cardState} inv=v${s.inviteVersion}(${s.inviteActive ? "on" : "off"}) msg=${s.msgSeq} A=${s.aliceMember ? "m" : "-"}/${s.aliceStream ? "s" : "-"}`,
};
