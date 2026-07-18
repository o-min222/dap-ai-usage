import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const plugin = await import(fileURLToPath(new URL("dap_ai_usage/plugin.mjs", root)));
const pluginSource = readFileSync(new URL("dap_ai_usage/plugin.mjs", root), "utf8");
const html = readFileSync(new URL("palette/index.html", root), "utf8");
for (const requiredFile of ["README.md", "LICENSE", "NOTICE.md", "docs/HOST_INTEGRATION.md", "output/playwright/ai-usage-dashboard.png"]) {
  assert.ok(readFileSync(new URL(requiredFile, root)).length > 100, `${requiredFile} must be included in the release`);
}
for (const icon of ["assets/codex.png", "assets/claude.png"]) {
  assert.ok(readFileSync(new URL(icon, root)).length > 1_000, `${icon} must contain a bundled app icon`);
}
assert.match(html, /\.\.\/assets\/codex\.png/);
assert.match(html, /\.\.\/assets\/claude\.png/);
const scripts = [...html.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)];
assert.ok(scripts.length, "palette must contain a script");
scripts.forEach((match, index) => new vm.Script(match[1], { filename: `palette/index.html#${index + 1}` }));

const normalized = plugin.normalizeProvider({
  provider: "codex",
  email: "user@example.com",
  active: true,
  usage: [{ label: "5시간", used: 25, limit: 100, resetAt: "2026-07-18T12:00:00Z" }],
});
assert.equal(normalized.name, "Codex");
assert.equal(normalized.usage[0].usedPercent, 25);
assert.equal(normalized.active, true);
assert.equal(plugin.normalizeProvider({ provider: "claude", status: "expired" }).status, "auth-expired");
assert.equal(plugin.normalizeProvider({ provider: "claude", status: "CONNECTED" }).connected, true);
assert.equal(plugin.normalizeProvider({ activeAccountId: "two", accounts: [{ id: "one", active: true }, { id: "two" }] }).accounts[1].active, true);
assert.equal(plugin.normalizeProvider({ dapActiveAccountId: "account-two", accounts: [{ id: "profile-two", accountId: "account-two" }] }).accounts[0].dapActive, true);
assert.equal(plugin.normalizeProvider({ dapActiveAccountId: "account-two", accounts: [{ id: "profile-two", accountId: "account-two" }] }).accounts[0].active, false);
assert.equal(plugin.normalizeProvider({ accounts: [{ id: "only", serviceActive: true }] }).accounts[0].active, true);
assert.equal(plugin.normalizeProvider({ usage: [{ label: "월간", usedPercent: 2 }, { label: "주간", usedPercent: 3 }, { label: "5시간", usedPercent: 4 }] }).usage.length, 2);
assert.deepEqual(plugin.normalizeProvider({ usage: [{ label: "주간", usedPercent: 3 }, { label: "5시간", usedPercent: 4 }] }).usage.map((item)=>item.kind), ["five-hour", "weekly"]);
assert.deepEqual(plugin.normalizeProvider({ usage: [{ kind: "weekly", label: "Limit B" }, { kind: "five-hour", label: "Limit A" }] }).usage.map((item)=>item.kind), ["five-hour", "weekly"]);
assert.deepEqual(plugin.normalizeProvider({ usage: [
  { label: "rolling limit", kind: "5-hour", usedPercent: 4 },
  { label: "7-day limit", usedPercent: 3 },
] }).usage.map((item)=>item.kind), ["five-hour", "weekly"]);
const accountUsage = plugin.normalizeProvider({ accounts: [{ id: "work", email: "work@example.com", usage: [{ label: "주간", usedPercent: 61 }] }] });
assert.equal(accountUsage.accounts[0].email, "work@example.com");
assert.equal(accountUsage.accounts[0].usage[0].usedPercent, 61);
const topLevel = plugin.normalizeOverview({
  activeAccount: { providerId: "codex", accountId: "work" },
  providers: [{ provider: "codex", accounts: [
    { id: "personal", active: true },
    { id: "work" },
  ] }],
});
assert.equal(topLevel.providers[0].accounts[0].active, false);
assert.equal(topLevel.providers[0].accounts[1].active, true);
const slotPriority = plugin.normalizeOverview({
  activeAccount: { providerId: "codex", accountId: "work" },
  providers: [{ provider: "codex", usage: [
    { label: "5시간", usedPercent: 42 }, { label: "주간", usedPercent: 68 },
  ], accounts: [
    { id: "personal" },
    { id: "work", usage: [{ label: "주간", usedPercent: 61 }] },
  ] }],
});
assert.deepEqual(slotPriority.providers[0].accounts[1].usage.map((item) => item.usedPercent), [42, 61]);
assert.equal(slotPriority.providers[0].accounts[0].usage.length, 0, "inactive account must not inherit provider usage");
const topLevelWins = plugin.normalizeOverview({
  dapAccount: { providerId: "claude", accountId: "selected" },
  providers: [
    { provider: "codex", accounts: [{ id: "legacy", dapActive: true }] },
    { provider: "claude", accounts: [{ id: "selected" }] },
  ],
});
assert.equal(topLevelWins.providers[0].accounts[0].dapActive, false, "top-level DAP account must clear stale DAP state on other providers");
assert.equal(topLevelWins.providers[1].accounts[0].dapActive, true);
assert.equal(topLevelWins.providers.flatMap((provider) => provider.accounts).filter((item) => item.dapActive).length, 1, "DAP must expose one headless account when dapAccount is authoritative");
assert.equal(topLevelWins.providers[1].accounts[0].active, false, "DAP account must not imply service active");
assert.equal(topLevelWins.warning, null);
const duplicateDapIds = plugin.normalizeOverview({
  dapAccount: { providerId: "codex", accountId: "same" },
  providers: [{ provider: "codex", accounts: [{ id: "same" }, { id: "same" }] }],
});
assert.equal(duplicateDapIds.providers[0].accounts.filter((item) => item.dapActive).length, 1, "authoritative dapAccount must mark exactly one account");
assert.match(plugin.normalizeOverview({
  dapAccount: { providerId: "codex", accountId: "missing" },
  providers: [{ provider: "codex", accounts: [{ id: "other", dapActive: true }] }],
}).warning, /DAP 사용 계정/);
const chipStates = plugin.normalizeOverview({
  activeAccount: { providerId: "codex", accountId: "same" },
  dapAccount: { providerId: "codex", accountId: "same" },
  providers: [{ provider: "codex", accounts: [
    { id: "same", accountType: "business" },
    { id: "personal", isPersonal: true },
  ] }],
});
assert.equal(chipStates.providers[0].accounts[0].active, true);
assert.equal(chipStates.providers[0].accounts[0].dapActive, true);
assert.equal(chipStates.providers[0].accounts[0].accountType, "business");
assert.equal(chipStates.providers[0].accounts[1].accountType, "personal");
assert.equal(plugin.normalizeProvider({ accounts: [{ id: "explicit", accountType: "personal", isBusiness: true }] }).accounts[0].accountType, "personal", "explicit account type must take priority over legacy flags");
assert.equal(plugin.normalizeProvider({ accounts: [{ id: "unknown", email: "user@company.com" }] }).accounts[0].accountType, null, "email domain must not infer account type");
assert.match(plugin.normalizeOverview({
  activeAccount: { providerId: "codex", accountId: "missing" },
  providers: [{ provider: "codex", accounts: [{ id: "other" }] }],
}).warning, /찾지 못했/);
const conflicting = plugin.normalizeOverview({ providers: [
  { provider: "codex", accounts: [{ id: "one", active: true }, { id: "two", active: true }] },
  { provider: "claude", accounts: [{ id: "three", active: true }] },
] });
assert.equal(conflicting.warning, null, "each service may have its own active account");
assert.equal(conflicting.providers[0].accounts.filter((item) => item.active).length, 1, "each service must expose at most one active account");
assert.equal(conflicting.providers[1].accounts.filter((item) => item.active).length, 1, "multiple services may each have an active account");
for (const expected of ["+ 새 계정 추가…", "<option disabled>──────────</option>", "__add__", 'data-action="add"', "add-account", "open-account-settings", "DAP 계정 설정…", "five-hour", "weekly", "usage-bottom", 'role="group"']) assert.ok(html.includes(expected));
for (const chip of ["chip current", "chip dap", "선택된 계정 상태", "회사 계정", "개인 계정"]) assert.ok(html.includes(chip));
assert.ok(!/accountOptions=.*a\.active\?/s.test(html), "select option text must not include active status");
assert.match(html, /\.usage\{[^}]*border-top:/, "usage rows must start below a top divider");
assert.match(html, /\.metric\+\.metric\{[^}]*border-top:/, "usage rows must have an inset divider");
assert.ok(!/\.metric\{[^}]*(background|border-radius)/.test(html), "usage rows must not use nested metric boxes");
assert.match(html, /card-head[^`]*account-select/s, "provider and account select must share the card header");
assert.ok(!html.includes('type:"switch-account"'), "query account select must not mutate the active account");
assert.ok(!html.includes('class="add-account"'), "account add must be a select option, not a separate button");
assert.ok(!html.includes('class="active-account"'), "header must not duplicate active account information");
assert.ok(html.includes("message.requestId!==provider._requestId"), "stale usage responses must not replace current metrics");
assert.ok(html.includes("provider._requestId=++usageRequestSequence"), "request ids must remain monotonic across overview refreshes");
assert.ok(html.includes('select.selectedOptions[0]?.dataset.action==="add"'), "add action must not depend on a collision-prone account id sentinel");
assert.ok(pluginSource.includes("requestId: message?.requestId"), "host bridge must echo the usage request id");
for (const forbidden of ["setActiveAccount", "setDapAccount", "setActiveProfile", "switchAccount", "selectAccount"]) {
  assert.ok(!pluginSource.includes(forbidden), `${forbidden} must not be called by this read-only dashboard`);
}

const registrations = {};
let messageHandler;
const posted = [];
let overviewCalls = 0;
let addArg = null;
let usageArgs = null;
let settingsOpened = false;
const fakePalette = {
  onMessage(handler) { messageHandler = handler; return () => {}; },
  postMessage(message) { posted.push(message); },
  show() {}, close() {}, isDestroyed() { return false; },
};
const dispose = plugin.activate({
  actions: { registerAction(item) { registrations[item.id] = item.callback; } },
  trayMenu: { addItem(item) { registrations.tray = item; } },
  radialMenu: { addItem(item) { registrations.radial = item; } },
  host: {
    windows: { openPalette() { return fakePalette; } },
    aiAccounts: {
      getUsageOverview() { overviewCalls += 1; return [{ provider: "claude", loggedIn: false }]; },
      addAccount(providerId) { addArg = providerId; return true; },
      getAccountUsage(providerId, accountId) { usageArgs = [providerId, accountId]; return { usage: [{ label: "주간", usedPercent: 12 }] }; },
    },
    settings: { openAccounts() { settingsOpened = true; } },
  },
});
assert.ok(registrations["open-ai-usage"]);
assert.equal(registrations.tray.actionId, "open-ai-usage");
assert.equal(registrations.tray.showInContextMenu, true);
assert.equal(registrations.radial.actionId, "open-ai-usage");
registrations["open-ai-usage"]();
await messageHandler({ type: "ready" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(posted.some((message) => message.type === "overview"));
const capabilityOverview = posted.findLast((message) => message.type === "overview");
assert.equal(capabilityOverview.providers[0].canAdd, true);
assert.equal(capabilityOverview.providers[0].canQueryUsage, true);
assert.equal(capabilityOverview.providers[0].canOpenSettings, true);
messageHandler({ type: "query-account-usage", requestId: 17, providerId: "claude", accountId: "work" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.deepEqual(usageArgs, ["claude", "work"]);
assert.ok(posted.some((message) => message.type === "account-usage" && message.requestId === 17), "usage response must echo its request id");
messageHandler({ type: "add-account", providerId: "claude" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(addArg, "claude");
assert.ok(overviewCalls >= 2, "account add must refresh the overview");
messageHandler({ type: "open-account-settings" });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.equal(settingsOpened, true);
dispose();

const manifest = readFileSync(new URL("plugin.yaml", root), "utf8");
for (const expected of ["id: io.github.o-min222.ai_usage", "version: 0.1.1", "manifest_version: 2", "entry: dap_ai_usage.plugin:activate", "- window.palette", "- ai.accounts"]) assert.ok(manifest.includes(expected));
console.log("ok manifest, plugin module, palette script, normalization, activation bridge");
