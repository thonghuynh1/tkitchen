export default [
  {
    label: "ownerRemoveAlice forgets to close Alice's SSE stream",
    expect: "INV-001",
    mutate: (m) => ({
      ...m,
      actions: {
        ...m.actions,
        ownerRemoveAlice: {
          ...m.actions.ownerRemoveAlice,
          step: (s) => ({
            ...s,
            aliceMember: false,
            inviteActive: false,
            aliceKickedAt: s.inviteVersion,
            aliceRemovedAtSeq: s.msgSeq,
          }),
        },
      },
    }),
  },
  {
    label: "ownerRemoveAlice forgets to revoke the active invite link",
    expect: "INV-002",
    mutate: (m) => ({
      ...m,
      actions: {
        ...m.actions,
        ownerRemoveAlice: {
          ...m.actions.ownerRemoveAlice,
          step: (s) => ({
            ...s,
            aliceMember: false,
            aliceStream: false,
            aliceKickedAt: s.inviteVersion,
            aliceRemovedAtSeq: s.msgSeq,
          }),
        },
      },
    }),
  },
  {
    label: "aliceCatchUp skips membership check after removal",
    expect: "INV-003",
    mutate: (m) => ({
      ...m,
      actions: {
        ...m.actions,
        aliceCatchUp: {
          ...m.actions.aliceCatchUp,
          step: (s) => ({ ...s, aliceSeenSeq: s.msgSeq }),
        },
      },
    }),
  },
  {
    label: "ownerArchiveCard forgets to revoke active invite link",
    expect: "INV-004",
    mutate: (m) => ({
      ...m,
      actions: {
        ...m.actions,
        ownerArchiveCard: {
          ...m.actions.ownerArchiveCard,
          step: (s) => ({
            ...s,
            cardState: "archived",
            aliceMember: false,
            aliceStream: false,
            charlieMember: false,
            charlieStream: false,
          }),
        },
      },
    }),
  },
  {
    label: "aliceCatchUp disabled while member is offline (no catch-up path)",
    expect: "PRG-001",
    mutate: (m) => ({
      ...m,
      actions: {
        ...m.actions,
        aliceCatchUp: {
          ...m.actions.aliceCatchUp,
          guard: () => false,
        },
        ownerRemoveAlice: {
          ...m.actions.ownerRemoveAlice,
          guard: () => false,
        },
        ownerCloseSharing: {
          ...m.actions.ownerCloseSharing,
          guard: () => false,
        },
        ownerArchiveCard: {
          ...m.actions.ownerArchiveCard,
          guard: () => false,
        },
      },
    }),
  },
];
