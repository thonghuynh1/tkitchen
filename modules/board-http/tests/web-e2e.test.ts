import { spawn, spawnSync } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { existsSync, readdirSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { SqliteCardStore } from "../../cards/adapters.ts";
import { CardService } from "../../cards/index.ts";
import { SqliteChatStore } from "../../chat/adapters.ts";
import { ChatService } from "../../chat/index.ts";
import { SqliteIdentityStore } from "../../identities/adapters.ts";
import { IdentityService, userIdFromGithub } from "../../identities/index.ts";
import type { GitHubOAuthPort, GitHubProfile } from "../../identities/index.ts";
import { InMemoryLiveHub } from "../../live/index.ts";
import { startBoardServer } from "../adapters.ts";
import type { BoardServer } from "../index.ts";

type CdpSessionId = string & { readonly cdpSessionIdBrand: "CdpSessionId" };
type CdpContextId = string & { readonly cdpContextIdBrand: "CdpContextId" };

const REPO_ROOT = resolve(import.meta.dirname, "..", "..", "..");
const WEB_ROOT = resolve(REPO_ROOT, "dist", "web");

class QueueOAuthPort implements GitHubOAuthPort {
  private nextCode = "owner";

  constructor(private readonly profiles: Record<string, GitHubProfile>) {}

  setNextLogin(code: string): void {
    this.nextCode = code;
  }

  authorizeUrl(input: { state: string; redirectUri: string }): string {
    const params = new URLSearchParams({ code: this.nextCode, state: input.state });
    return input.redirectUri + "?" + params.toString();
  }

  exchangeCode(input: { code: string }): Promise<GitHubProfile> {
    const profile = this.profiles[input.code];
    return profile === undefined ? Promise.reject(new Error("unknown code")) : Promise.resolve(profile);
  }
}

class CountingIds {
  private counter = 0;

  next(): string {
    this.counter += 1;
    return "00000000-0000-4000-8000-" + String(this.counter).padStart(12, "0");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function findPlaywrightChromium(): string | null {
  const localAppData = process.env["LOCALAPPDATA"];
  const bases = [
    ...(localAppData !== undefined ? [join(localAppData, "ms-playwright")] : []),
    ...(process.env["HOME"] !== undefined ? [join(process.env["HOME"], ".cache", "ms-playwright")] : []),
  ];
  for (const base of bases) {
    if (!existsSync(base)) continue;
    const dirs = readdirSync(base)
      .filter((name) => name.startsWith("chromium-"))
      .sort()
      .reverse();
    for (const dir of dirs) {
      const candidates = [
        join(base, dir, "chrome-win64", "chrome.exe"),
        join(base, dir, "chrome-win", "chrome.exe"),
        join(base, dir, "chrome-linux", "chrome"),
        join(base, dir, "chrome-mac", "Chromium.app", "Contents", "MacOS", "Chromium"),
      ];
      for (const candidate of candidates) {
        if (existsSync(candidate)) return candidate;
      }
    }
  }
  return null;
}

function findBrowserExecutable(): string {
  const fromEnv = process.env["CHROME_PATH"];
  if (fromEnv !== undefined && existsSync(fromEnv)) return fromEnv;
  const pw = findPlaywrightChromium();
  if (pw !== null) return pw;
  const fallbacks = [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
    "C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
  ];
  for (const candidate of fallbacks) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error("No Chromium or Edge executable found for headless browser E2E test");
}

function sleep(ms: number): Promise<void> {
  return new Promise((done) => {
    setTimeout(done, ms);
  });
}

class CdpClient {
  private nextCommand = 0;
  private readonly pending = new Map<
    number,
    { resolve: (value: Record<string, unknown>) => void; reject: (err: Error) => void }
  >();

  constructor(private readonly socket: WebSocket) {
    socket.addEventListener("message", (rawEvt) => {
      if (typeof rawEvt.data !== "string") return;
      const parsed: unknown = JSON.parse(rawEvt.data);
      if (!isRecord(parsed)) return;
      const commandId = parsed["id"];
      if (typeof commandId !== "number") return;
      const entry = this.pending.get(commandId);
      if (entry === undefined) return;
      this.pending.delete(commandId);
      const errObj = parsed["error"];
      if (isRecord(errObj)) {
        entry.reject(new Error(String(errObj["message"] ?? "CDP error")));
        return;
      }
      const payload = parsed["result"];
      entry.resolve(isRecord(payload) ? payload : {});
    });
  }

  send(method: string, params: Record<string, unknown> = {}, session?: CdpSessionId): Promise<Record<string, unknown>> {
    this.nextCommand += 1;
    const commandId = this.nextCommand;
    const body: Record<string, unknown> = { id: commandId, method, params };
    if (session !== undefined) body["sessionId"] = session;
    return new Promise((resolveCmd, rejectCmd) => {
      this.pending.set(commandId, { resolve: resolveCmd, reject: rejectCmd });
      this.socket.send(JSON.stringify(body));
    });
  }

  close(): void {
    this.socket.close();
  }
}

class BrowserPage {
  constructor(
    private readonly client: CdpClient,
    private readonly session: CdpSessionId,
    readonly context: CdpContextId,
  ) {}

  async navigate(url: string): Promise<void> {
    await this.client.send("Page.navigate", { url }, this.session);
  }

  async evaluate(expression: string): Promise<unknown> {
    const reply = await this.client.send(
      "Runtime.evaluate",
      { expression, awaitPromise: true, returnByValue: true },
      this.session,
    );
    const exception = reply["exceptionDetails"];
    if (isRecord(exception)) {
      throw new Error("Page evaluation failed: " + JSON.stringify(exception));
    }
    const inner = reply["result"];
    return isRecord(inner) ? inner["value"] : undefined;
  }

  async waitFor(expression: string, timeoutMs = 8000): Promise<unknown> {
    const deadline = Date.now() + timeoutMs;
    let lastValue: unknown = undefined;
    while (Date.now() < deadline) {
      try {
        lastValue = await this.evaluate(expression);
        if (Boolean(lastValue)) return lastValue;
      } catch {
        lastValue = undefined;
      }
      await sleep(50);
    }
    const bodyText = await this.evaluate("document.body ? document.body.innerText : ''").catch(() => "");
    throw new Error(
      "Timed out waiting for: " + expression + " (last=" + String(lastValue) + ", body=" + String(bodyText) + ")",
    );
  }

  async waitForText(text: string, timeoutMs = 8000): Promise<void> {
    await this.waitFor("(document.body?.innerText ?? '').includes(" + JSON.stringify(text) + ")", timeoutMs);
  }

  async waitForNoText(text: string, timeoutMs = 8000): Promise<void> {
    await this.waitFor(
      "Boolean(document.body) && !document.body.innerText.includes(" + JSON.stringify(text) + ")",
      timeoutMs,
    );
  }

  async clickSelector(selector: string): Promise<void> {
    await this.waitFor("document.querySelector(" + JSON.stringify(selector) + ") !== null");
    const clicked = await this.evaluate(
      "(() => { const el = document.querySelector(" +
        JSON.stringify(selector) +
        "); if (!el) return false; el.click(); return true; })()",
    );
    expect(clicked).toBe(true);
  }

  async clickButtonByText(label: string): Promise<void> {
    const expr =
      "(() => { const el = [...document.querySelectorAll('button, a')].find((node) => node.textContent && node.textContent.trim() === " +
      JSON.stringify(label) +
      "); if (!el) return false; el.click(); return true; })()";
    await this.waitFor(expr);
  }

  async focusAndType(selector: string, text: string): Promise<void> {
    await this.waitFor("document.querySelector(" + JSON.stringify(selector) + ") !== null");
    const focused = await this.evaluate(
      "(() => { const el = document.querySelector(" +
        JSON.stringify(selector) +
        "); if (!el) return false; el.focus(); return true; })()",
    );
    expect(focused).toBe(true);
    await this.client.send("Input.insertText", { text }, this.session);
  }

  async pressKey(key: string): Promise<void> {
    const codeMap: Record<string, { code: string; keyCode: number }> = {
      Enter: { code: "Enter", keyCode: 13 },
      Tab: { code: "Tab", keyCode: 9 },
      Escape: { code: "Escape", keyCode: 27 },
    };
    const spec = codeMap[key] ?? { code: key, keyCode: 0 };
    await this.client.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyDown",
        key,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
      },
      this.session,
    );
    await this.client.send(
      "Input.dispatchKeyEvent",
      {
        type: "keyUp",
        key,
        code: spec.code,
        windowsVirtualKeyCode: spec.keyCode,
        nativeVirtualKeyCode: spec.keyCode,
      },
      this.session,
    );
  }
}

interface HeadlessBrowser {
  newPage(): Promise<BrowserPage>;
  close(): Promise<void>;
}

function isCdpSessionId(value: unknown): value is CdpSessionId {
  return typeof value === "string" && value.length > 0;
}

function isCdpContextId(value: unknown): value is CdpContextId {
  return typeof value === "string" && value.length > 0;
}

async function launchHeadlessBrowser(): Promise<HeadlessBrowser> {
  const userDataDir = await mkdtemp(join(tmpdir(), "tkitchen-cdp-profile-"));
  const executable = findBrowserExecutable();
  const proc: ChildProcess = spawn(
    executable,
    [
      "--headless=new",
      "--remote-debugging-port=0",
      "--user-data-dir=" + userDataDir,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      "--disable-extensions",
      "about:blank",
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );

  const wsUrl = await new Promise<string>((resolveUrl, rejectUrl) => {
    let stderrText = "";
    const timer = setTimeout(() => {
      rejectUrl(new Error("Timed out waiting for headless browser DevTools URL: " + stderrText));
    }, 15_000);
    proc.once("exit", (code) => {
      clearTimeout(timer);
      rejectUrl(new Error("Headless browser exited early with code " + String(code) + ": " + stderrText));
    });
    proc.stderr?.on("data", (chunk: Buffer) => {
      stderrText += chunk.toString("utf8");
      const matched = /DevTools listening on (ws:\/\/[^\s]+)/.exec(stderrText);
      if (matched?.[1] !== undefined) {
        clearTimeout(timer);
        resolveUrl(matched[1]);
      }
    });
  });

  const socket = new WebSocket(wsUrl);
  await new Promise<void>((resolveOpen, rejectOpen) => {
    socket.addEventListener("open", () => {
      resolveOpen();
    });
    socket.addEventListener("error", () => {
      rejectOpen(new Error("Failed to connect to headless browser WebSocket"));
    });
  });

  const client = new CdpClient(socket);
  const contexts: CdpContextId[] = [];

  return {
    async newPage(): Promise<BrowserPage> {
      const ctxReply = await client.send("Target.createBrowserContext");
      const context = ctxReply["browserContextId"];
      if (!isCdpContextId(context)) throw new Error("Missing browserContextId");
      contexts.push(context);
      const pageReply = await client.send("Target.createTarget", { url: "about:blank", browserContextId: context });
      const pageToken = pageReply["targetId"];
      if (typeof pageToken !== "string") throw new Error("Missing targetId");
      const attachReply = await client.send("Target.attachToTarget", { targetId: pageToken, flatten: true });
      const session = attachReply["sessionId"];
      if (!isCdpSessionId(session)) throw new Error("Missing sessionId");
      await client.send("Page.enable", {}, session);
      await client.send("Runtime.enable", {}, session);
      return new BrowserPage(client, session, context);
    },
    async close(): Promise<void> {
      for (const context of contexts) {
        await client.send("Target.disposeBrowserContext", { browserContextId: context }).catch(() => undefined);
      }
      client.close();
      proc.kill();
      await new Promise<void>((resolveExit) => {
        if (proc.exitCode !== null) {
          resolveExit();
          return;
        }
        proc.once("exit", () => {
          resolveExit();
        });
        setTimeout(resolveExit, 2000);
      });
      await rm(userDataDir, { recursive: true, force: true }).catch(() => undefined);
    },
  };
}

let browser: HeadlessBrowser;
let home: string;
let identityStore: SqliteIdentityStore;
let cardStore: SqliteCardStore;
let chatStore: SqliteChatStore;
let liveHub: InMemoryLiveHub;
let oauth: QueueOAuthPort;
let board: BoardServer;

beforeAll(async () => {
  const viteBin = resolve(REPO_ROOT, "node_modules", "vite", "bin", "vite.js");
  const buildOutcome = spawnSync(process.execPath, [viteBin, "build"], { cwd: REPO_ROOT, encoding: "utf8" });
  if (buildOutcome.status !== 0) {
    throw new Error("vite build failed: " + buildOutcome.stderr + "\n" + buildOutcome.stdout);
  }
  browser = await launchHeadlessBrowser();
}, 30_000);

afterAll(async () => {
  await browser.close();
});

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), "tkitchen-web-e2e-"));
  const dbPath = join(home, "board.db");
  const fixedClock = { now: (): Date => new Date(1_700_000_000_000) };
  identityStore = new SqliteIdentityStore(dbPath);
  cardStore = new SqliteCardStore(dbPath);
  chatStore = new SqliteChatStore(dbPath);
  liveHub = new InMemoryLiveHub();
  oauth = new QueueOAuthPort({
    owner: { githubId: 1, login: "owner" },
    alice: { githubId: 2, login: "alice" },
  });
  const identities = new IdentityService({
    store: identityStore,
    oauth,
    clock: fixedClock,
    ids: new CountingIds(),
    ownerId: userIdFromGithub(1),
  });
  const cards = new CardService({ store: cardStore, clock: fixedClock, ids: new CountingIds() });
  const chat = new ChatService({ store: chatStore, cards: cardStore, clock: fixedClock, ids: new CountingIds() });
  board = await startBoardServer({
    port: 0,
    host: "127.0.0.1",
    webRoot: WEB_ROOT,
    identities,
    cards,
    chat,
    live: liveHub,
  });
});

afterEach(async () => {
  await board.close();
  chatStore.close();
  cardStore.close();
  identityStore.close();
  await rm(home, { recursive: true, force: true });
});

describe("board web UI E2E", () => {
  it("two users sign in, join by invite link, chat live with @waiter picker, and removal clears board and stops chat", async () => {
    const ownerPage = await browser.newPage();
    const alicePage = await browser.newPage();

    oauth.setNextLogin("owner");
    await ownerPage.navigate(board.url + "/");
    await ownerPage.waitForText("Sign in with GitHub");
    await ownerPage.clickButtonByText("Sign in with GitHub");
    await ownerPage.waitForText("New card");
    expect(await ownerPage.evaluate("document.querySelector('[data-testid=\"signed-in-login\"]')?.textContent")).toBe(
      "owner",
    );

    await ownerPage.clickButtonByText("New card");
    await ownerPage.focusAndType("#new-card-title", "Card 1");
    await ownerPage.clickButtonByText("Create card");
    await ownerPage.waitForText("Card 1");

    await ownerPage.clickButtonByText("Copy invite link");
    const inviteUrl = await ownerPage.waitFor(
      "document.querySelector('[data-testid^=\"invite-url-\"]')?.textContent ?? ''",
    );
    expect(typeof inviteUrl).toBe("string");
    expect(String(inviteUrl)).toContain("/invite/");

    await ownerPage.clickButtonByText("Chat");
    await ownerPage.waitFor("document.querySelector('[data-testid=\"card-chat-panel\"]') !== null");

    oauth.setNextLogin("alice");
    await alicePage.navigate(String(inviteUrl));
    await alicePage.waitForText("Card 1");
    await alicePage.waitFor("document.querySelector('[data-testid=\"card-chat-panel\"]') !== null");
    expect(await alicePage.evaluate("document.querySelector('[data-testid=\"signed-in-login\"]')?.textContent")).toBe(
      "alice",
    );
    expect(await alicePage.evaluate("document.body.innerText.includes('New card')")).toBe(false);
    expect(await alicePage.evaluate("document.body.innerText.includes('Delete card')")).toBe(false);

    await alicePage.clickButtonByText("Doing");
    await ownerPage.waitFor(
      "document.querySelector('[data-testid=\"column-doing\"]')?.textContent?.includes('Card 1') === true",
    );

    await alicePage.focusAndType('textarea[aria-label="Chat composer"]', "please check @w");
    await alicePage.waitFor("document.querySelector('[data-testid=\"mention-picker\"]') !== null");
    await alicePage.pressKey("Enter");
    await alicePage.waitFor(
      "document.querySelector('textarea[aria-label=\"Chat composer\"]')?.value === 'please check @waiter '",
    );
    await alicePage.focusAndType('textarea[aria-label="Chat composer"]', "status");
    await alicePage.clickButtonByText("Send");

    await alicePage.waitForText("please check @waiter status");
    await ownerPage.waitForText("please check @waiter status");
    expect(
      await ownerPage.evaluate(
        "document.querySelector('[data-testid=\"chat-entry-1\"]')?.textContent?.includes('@waiter') === true",
      ),
    ).toBe(true);

    await ownerPage.clickButtonByText("Reply");
    await ownerPage.focusAndType('textarea[aria-label="Chat composer"]', "on it");
    await ownerPage.clickButtonByText("Send");
    await alicePage.waitForText("on it");

    await ownerPage.waitFor("document.querySelector('[data-testid=\"member-github:2\"]') !== null");
    await ownerPage.clickSelector('button[aria-label="Remove alice"]');

    await alicePage.waitFor("document.querySelector('[data-testid=\"card-chat-panel\"]') === null");
    await alicePage.waitForText("No cards yet — ask the owner for an invite.");
    await alicePage.waitForText("This card was removed from your board and its chat has closed.");

    await alicePage.navigate(String(inviteUrl));
    await alicePage.waitForText("This invite link is no longer valid");
  }, 30_000);

  it("close sharing and delete card update clients live and sign out returns to GitHub login", async () => {
    const ownerPage = await browser.newPage();
    const alicePage = await browser.newPage();

    oauth.setNextLogin("owner");
    await ownerPage.navigate(board.url + "/");
    await ownerPage.clickButtonByText("Sign in with GitHub");
    await ownerPage.waitForText("New card");

    await ownerPage.clickButtonByText("New card");
    await ownerPage.focusAndType("#new-card-title", "Shared Card");
    await ownerPage.clickButtonByText("Create card");
    await ownerPage.waitForText("Shared Card");

    await ownerPage.clickButtonByText("Copy invite link");
    const inviteUrl = await ownerPage.waitFor(
      "document.querySelector('[data-testid^=\"invite-url-\"]')?.textContent ?? ''",
    );

    oauth.setNextLogin("alice");
    await alicePage.navigate(String(inviteUrl));
    await alicePage.waitForText("Shared Card");
    await alicePage.waitFor("document.querySelector('[data-testid=\"card-chat-panel\"]') !== null");

    await ownerPage.clickButtonByText("Close sharing");
    await alicePage.waitFor("document.querySelector('[data-testid=\"card-chat-panel\"]') === null");
    await alicePage.waitForText("No cards yet — ask the owner for an invite.");

    await ownerPage.clickButtonByText("Delete card");
    await ownerPage.clickButtonByText("Confirm delete");
    await ownerPage.waitForNoText("Shared Card");

    await ownerPage.clickButtonByText("Sign out");
    await ownerPage.waitForText("Sign in with GitHub");
  }, 30_000);

  it("switching cards clears unsent drafts and idle invitee appears immediately for owner removal", async () => {
    const ownerPage = await browser.newPage();
    const alicePage = await browser.newPage();

    oauth.setNextLogin("owner");
    await ownerPage.navigate(board.url + "/");
    await ownerPage.clickButtonByText("Sign in with GitHub");
    await ownerPage.waitForText("New card");

    await ownerPage.clickButtonByText("New card");
    await ownerPage.focusAndType("#new-card-title", "Card A");
    await ownerPage.clickButtonByText("Create card");
    await ownerPage.waitForText("Card A");

    await ownerPage.clickButtonByText("New card");
    await ownerPage.focusAndType("#new-card-title", "Card B");
    await ownerPage.clickButtonByText("Create card");
    await ownerPage.waitForText("Card B");

    await ownerPage.clickSelector('button[aria-label="Open chat for Card A"]');
    await ownerPage.waitFor("document.querySelector('[data-testid=\"card-chat-panel\"]') !== null");
    await ownerPage.focusAndType('textarea[aria-label="Chat composer"]', "draft for Card A");
    expect(await ownerPage.evaluate("document.querySelector('textarea[aria-label=\"Chat composer\"]')?.value")).toBe(
      "draft for Card A",
    );

    await ownerPage.clickSelector('button[aria-label="Open chat for Card B"]');
    await ownerPage.waitFor(
      "document.querySelector('[data-testid=\"card-chat-panel\"]')?.textContent?.includes('Card B') === true",
    );
    expect(await ownerPage.evaluate("document.querySelector('textarea[aria-label=\"Chat composer\"]')?.value")).toBe(
      "",
    );

    await ownerPage.waitFor(
      "(() => { const card = document.querySelector('[data-card-title=\"Card A\"]'); const btn = [...(card?.querySelectorAll('button') ?? [])].find((n) => n.textContent?.trim() === 'Copy invite link'); if (!btn) return false; btn.click(); return true; })()",
    );
    const inviteUrl = await ownerPage.waitFor(
      "document.querySelector('[data-card-title=\"Card A\"] [data-testid^=\"invite-url-\"]')?.textContent ?? ''",
    );
    expect(String(inviteUrl)).toContain("/invite/");

    oauth.setNextLogin("alice");
    await alicePage.navigate(String(inviteUrl));
    await alicePage.waitForText("Card A");
    await alicePage.waitFor("document.querySelector('[data-testid=\"card-chat-panel\"]') !== null");

    await ownerPage.waitFor(
      'document.querySelector(\'[data-card-title="Card A"] [data-testid="member-github:2"]\') !== null',
    );
    await ownerPage.clickSelector('[data-card-title="Card A"] [data-testid="member-github:2"] button');

    await alicePage.waitFor("document.querySelector('[data-testid=\"card-chat-panel\"]') === null");
    await alicePage.waitForText("No cards yet — ask the owner for an invite.");
  }, 30_000);
});
