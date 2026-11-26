import { describe, expect, it } from "vitest";
import { parseCommand } from "../index.ts";

describe("board --public-url", () => {
  it("parses --public-url and rejects invalid URLs", () => {
    expect(parseCommand(["board", "--public-url", "https://board.example.test/"])).toEqual({
      ok: true,
      command: { kind: "board", port: 3000, host: "127.0.0.1", publicUrl: "https://board.example.test" },
    });
    expect(parseCommand(["board", "--public-url", "http://127.0.0.1:4000"])).toEqual({
      ok: true,
      command: { kind: "board", port: 3000, host: "127.0.0.1", publicUrl: "http://127.0.0.1:4000" },
    });
    const refusal = { ok: false, complaint: "--public-url needs an http or https URL", showUsage: false };
    for (const bad of ["ftp://bad", "not a url", "javascript:alert(1)"]) {
      expect(parseCommand(["board", "--public-url", bad])).toEqual(refusal);
    }
    expect(parseCommand(["board", "--public-url"])).toEqual(refusal);
  });

  it("leaves publicUrl undefined when the flag is absent", () => {
    const parsed = parseCommand(["board"]);
    expect(parsed.ok && parsed.command.kind === "board" ? parsed.command.publicUrl : "wrong").toBeUndefined();
  });
});
