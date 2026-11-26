import { describe, it, expect } from "vitest";
import { PortError } from "../../platform/index.ts";
import type { Forge, PullRequest } from "../index.ts";
import type { RepoConfig } from "../../config/index.ts";

export interface ForgeScripting {
  open: (pr: PullRequest) => void;
  failNext: () => void;
  dispose: () => void;
}
export type ScriptedForge = Forge & ForgeScripting;

export const FORGE_REPO: RepoConfig = { name: "x", path: process.cwd(), remote: "origin", forge: "github", bases: {} };

const PR_ONE: PullRequest = {
  number: 7,
  head: "feature-2",
  base: "feature-1",
  url: "https://example.invalid/pr/7",
  author: "alice",
  crossRepository: false,
};
const PR_TWO: PullRequest = {
  number: 9,
  head: "feature-3",
  base: "main",
  url: "https://example.invalid/pr/9",
  author: "bob",
  crossRepository: false,
};

export function forgeContract(name: string, make: () => ScriptedForge): void {
  describe(name, () => {
    it("two PRs mapped correctly", async () => {
      const forge = make();
      try {
        forge.open(PR_ONE);
        forge.open(PR_TWO);
        const prs = await forge.listOpenPullRequests(FORGE_REPO);
        expect(prs).toEqual([PR_ONE, PR_TWO]);
      } finally {
        forge.dispose();
      }
    });
    it("fork PR flagged", async () => {
      const forge = make();
      try {
        forge.open({ ...PR_ONE, crossRepository: true });
        const prs = await forge.listOpenPullRequests(FORGE_REPO);
        expect(prs).toHaveLength(1);
        expect(prs[0]?.crossRepository).toBe(true);
        expect(prs[0]?.head).toBe("feature-2");
      } finally {
        forge.dispose();
      }
    });
    it("failure becomes PortError", async () => {
      const forge = make();
      try {
        forge.failNext();
        await expect(forge.listOpenPullRequests(FORGE_REPO)).rejects.toBeInstanceOf(PortError);
      } finally {
        forge.dispose();
      }
    });
  });
}
