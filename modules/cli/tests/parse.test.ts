import { describe, it, expect } from "vitest";
import { parseCommand } from "../index.ts";

describe("parseCommand", () => {
  it("no words asks for help", () => {
    expect(parseCommand([])).toEqual({ ok: true, command: { kind: "help" } });
  });
  it("every help spelling asks for help", () => {
    for (const word of ["--help", "-h", "help"]) {
      expect(parseCommand([word])).toEqual({ ok: true, command: { kind: "help" } });
    }
  });
  it("an unknown command is refused with the usage", () => {
    expect(parseCommand(["bogus"])).toEqual({
      ok: false,
      complaint: "unknown command: bogus",
      showUsage: true,
    });
  });
  it("serve takes no arguments", () => {
    expect(parseCommand(["serve"])).toEqual({ ok: true, command: { kind: "serve" } });
    expect(parseCommand(["serve", "--nope"])).toEqual({
      ok: false,
      complaint: "unknown argument: --nope",
      showUsage: false,
    });
  });
  it("board defaults to port 3000 on this machine", () => {
    expect(parseCommand(["board"])).toEqual({
      ok: true,
      command: { kind: "board", port: 3000, host: "127.0.0.1" },
    });
  });
  it("board takes a port and a host", () => {
    expect(parseCommand(["board", "--port", "8080", "--host", "0.0.0.0"])).toEqual({
      ok: true,
      command: { kind: "board", port: 8080, host: "0.0.0.0" },
    });
  });
  it("board refuses a port that is not a number from 0 to 65535", () => {
    for (const bad of ["nope", "70000", "-1"]) {
      expect(parseCommand(["board", "--port", bad])).toEqual({
        ok: false,
        complaint: "--port needs a number from 0 to 65535",
        showUsage: false,
      });
    }
    expect(parseCommand(["board", "--port"])).toEqual({
      ok: false,
      complaint: "--port needs a number from 0 to 65535",
      showUsage: false,
    });
  });
  it("board refuses a host with no address", () => {
    expect(parseCommand(["board", "--host"])).toEqual({
      ok: false,
      complaint: "--host needs an address",
      showUsage: false,
    });
  });
  it("round runs for every repo unless one is named", () => {
    expect(parseCommand(["round"])).toEqual({ ok: true, command: { kind: "round", onlyRepo: undefined } });
    expect(parseCommand(["round", "--repo", "kitchen"])).toEqual({
      ok: true,
      command: { kind: "round", onlyRepo: "kitchen" },
    });
  });
  it("round refuses a repo flag with no name and unknown arguments", () => {
    expect(parseCommand(["round", "--repo"])).toEqual({
      ok: false,
      complaint: "--repo needs a name",
      showUsage: false,
    });
    expect(parseCommand(["round", "--nope", "x"])).toEqual({
      ok: false,
      complaint: "unknown argument: --nope",
      showUsage: false,
    });
  });
  it("export needs --json, shown by the usage alone", () => {
    expect(parseCommand(["export"])).toEqual({ ok: false, complaint: null, showUsage: true });
    expect(parseCommand(["export", "--json"])).toEqual({
      ok: true,
      command: { kind: "export", after: undefined },
    });
  });
  it("export takes one cursor", () => {
    expect(parseCommand(["export", "--json", "--after", "c1"])).toEqual({
      ok: true,
      command: { kind: "export", after: "c1" },
    });
    expect(parseCommand(["export", "--json", "--after", "c1", "--after", "c2"])).toEqual({
      ok: false,
      complaint: "unknown argument: --after",
      showUsage: false,
    });
    expect(parseCommand(["export", "--after"])).toEqual({
      ok: false,
      complaint: "invalid cursor",
      showUsage: false,
    });
  });
  it("export refuses a second --json", () => {
    expect(parseCommand(["export", "--json", "--json"])).toEqual({
      ok: false,
      complaint: "unknown argument: --json",
      showUsage: false,
    });
  });
  it("notices reads its flags from anywhere and ignores the rest", () => {
    expect(parseCommand(["notices"])).toEqual({
      ok: true,
      command: { kind: "notices", json: false, history: false },
    });
    expect(parseCommand(["notices", "--history", "--json", "--nope"])).toEqual({
      ok: true,
      command: { kind: "notices", json: true, history: true },
    });
  });
});
