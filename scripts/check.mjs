import { readFileSync } from "node:fs";
import vm from "node:vm";
import assert from "node:assert/strict";

const root = new URL("../", import.meta.url);
const plugin = await import(new URL("dap_ai_usage/plugin.mjs", root));
const pluginSource = readFileSync(new URL("dap_ai_usage/plugin.mjs", root), "utf8");
const html = readFileSync(new URL("palette/index.html", root), "utf8");
for (const requiredFile of ["README.md", "LICENSE", "NOTICE.md", "docs/HOST_INTEGRATION.md", "output/playwright/ai-usage-dashboard.png", "output/playwright/ai-usage-account-menu.png"]) {
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
const usageLineFallback = plugin.normalizeProvider({ provider: "claude", usage: [], usageLines: [
  "Current session: 9 percent used · resets Jul 19, 6:10pm (Etc/GMT-9)",
  "Current week (all models): 22% used · resets Jul 21, 7pm (Etc/GMT-9)",
] });
assert.deepEqual(usageLineFallback.usage.map((item) => item.usedPercent), [9, 22]);
assert.match(usageLineFallback.usage[0].detail, /Jul 19/);
const structuredUsageWins = plugin.normalizeProvider({ usage: [{ kind: "five-hour", label: "5시간", usedPercent: 7 }], usageLines: [
  "Current session: 99% used · resets later",
  "Current week (all models): 33% used · resets later",
] });
assert.deepEqual(structuredUsageWins.usage.map((item) => item.usedPercent), [7, 33]);
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
const traySummary = plugin.buildTraySubmenu(plugin.normalizeOverview({
  dapAccount: { providerId: "claude", accountId: "claude-dap" },
  providers: [
    { provider: "claude", accounts: [
      { id: "claude-dap", dapActive: true, usage: [{ kind: "five-hour", usedPercent: 99 }] },
      { id: "claude-active", active: true, usage: [{ kind: "five-hour", usedPercent: 9 }, { kind: "weekly", usedPercent: 22 }] },
    ] },
    { provider: "codex", activeAccountId: "codex-active", accounts: [
      { id: "codex-active", usage: [{ kind: "five-hour", usedPercent: 25 }, { kind: "weekly", usedPercent: 61 }] },
    ] },
  ],
}));
assert.deepEqual(traySummary.filter((item) => item.actionId).map((item) => item.itemId), [
  "codex-five-hour", "codex-weekly", "claude-five-hour", "claude-weekly", "details",
]);
assert.match(traySummary.find((item) => item.itemId === "codex-five-hour").label, /Codex · 5시간 25%/);
assert.match(traySummary.find((item) => item.itemId === "claude-five-hour").label, /Claude · 5시간 9%/);
assert.ok(!traySummary.find((item) => item.itemId === "claude-five-hour").label.includes("(DAP)"), "service-active account must win over DAP fallback");
const dapFallback = plugin.buildTraySubmenu(plugin.normalizeOverview({ providers: [
  { provider: "claude", dapActiveAccountId: "dap", accounts: [{ id: "dap", usage: [{ kind: "weekly", usedPercent: 33 }] }] },
] }));
assert.match(dapFallback.find((item) => item.itemId === "claude-weekly").label, /Claude \(DAP\) · 주간 33%/);
assert.equal(dapFallback.find((item) => item.itemId === "claude-five-hour").enabled, false);
assert.equal(plugin.buildTraySubmenu({ error: "조회 실패" })[0].enabled, false);
for (const expected of ["＋ 다른 계정 연결", "account-trigger", "account-menu", 'role="menu"', 'role="menuitemradio"', 'role="menuitem"', "data-account-id", 'data-action="add"', "add-account", "open-account-settings", "DAP 계정 설정…", "five-hour", "weekly", 'class="metric"', 'role="group"']) assert.ok(html.includes(expected));
for (const chip of ["chip current", "chip dap", "선택된 계정 상태", "회사 계정", "개인 계정"]) assert.ok(html.includes(chip));
assert.ok(!html.includes("<select"), "native account selects must not be used");
assert.match(html, /\.metric\{[^}]*display:grid[^}]*grid-template-columns:/, "each usage limit must stay on one compact row");
assert.ok(!/\.usage\{[^}]*border(?:-top)?:/.test(html), "usage group must not add a horizontal divider");
assert.ok(!/\.metric\+\.metric\{[^}]*border(?:-top)?:/.test(html), "usage rows must not add horizontal dividers");
assert.ok(!/\.metric\{[^}]*(background|border-radius)/.test(html), "usage rows must not use nested metric boxes");
assert.match(html, /card-head[^`]*account-picker/s, "provider and custom account picker must share the card header");
assert.ok(!html.includes('type:"switch-account"'), "query account select must not mutate the active account");
assert.match(html, /account-menu[^`]*account-add/s, "account add must stay inside the account menu");
assert.ok(html.includes('aria-label="${attr(`${provider.name} 계정, ${selectedName}`)}"'), "account trigger must identify its provider and selected account");
for (const key of ["ArrowDown", "ArrowUp", "Home", "End"]) assert.ok(html.includes(`"${key}"`), `account menu must support ${key}`);
assert.ok(html.includes('tabindex="-1" data-account-id'), "account choices must use roving programmatic focus");
assert.ok(html.includes('if(event.key==="Tab"){closeMenus();return}'), "Tab must close an open account menu");
assert.ok(!html.includes('class="active-account"'), "header must not duplicate active account information");
assert.ok(html.includes("message.requestId!==provider._requestId"), "stale usage responses must not replace current metrics");
assert.ok(html.includes("provider._requestId=++usageRequestSequence"), "request ids must remain monotonic across overview refreshes");
assert.ok(html.includes("pendingAdds.set(provider.id"), "adding an account must remember the previous account ids");
assert.ok(html.includes("provider._selectedId=added.accountId||added.id"), "a newly discovered account must become the viewed account");
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
const trayUpdates = [];
let clearedTimer = false;
const originalSetInterval = globalThis.setInterval;
const originalClearInterval = globalThis.clearInterval;
globalThis.setInterval = (_callback, delay) => ({ delay, unref() {} });
globalThis.clearInterval = (timer) => { clearedTimer = timer?.delay === 5 * 60 * 1000; };
const fakePalette = {
  onMessage(handler) { messageHandler = handler; return () => {}; },
  postMessage(message) { posted.push(message); },
  show() {}, close() {}, isDestroyed() { return false; },
};
const dispose = plugin.activate({
  actions: { registerAction(item) { registrations[item.id] = item.callback; } },
  trayMenu: { addItem(item) { registrations.tray = item; return { update(patch) { trayUpdates.push(patch); } }; } },
  radialMenu: { addItem(item) { registrations.radial = item; } },
  host: {
    windows: { openPalette() { return fakePalette; } },
    aiAccounts: {
      getUsageOverview() {
        overviewCalls += 1;
        return { providers: [{ provider: "claude", activeAccountId: "current", accounts: [
          { id: "current", usage: [{ kind: "five-hour", usedPercent: 7 }, { kind: "weekly", usedPercent: 12 }] },
        ] }] };
      },
      addAccount(providerId) { addArg = providerId; return true; },
      getAccountUsage(providerId, accountId) { usageArgs = [providerId, accountId]; return { usage: [{ label: "주간", usedPercent: 12 }] }; },
    },
    settings: { openAccounts() { settingsOpened = true; } },
  },
});
assert.ok(registrations["open-ai-usage"]);
assert.equal(registrations.tray.actionId, "open-ai-usage");
assert.equal(registrations.tray.showInContextMenu, true);
assert.match(registrations.tray.submenu[0].label, /불러오는 중/);
assert.equal(registrations.radial.actionId, "open-ai-usage");
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(trayUpdates.some((patch) => patch.submenu.some((item) => item.itemId === "claude-five-hour" && item.actionId === "open-ai-usage")));
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
assert.equal(clearedTimer, true, "deactivate must clear the five-minute tray refresh timer");
globalThis.setInterval = originalSetInterval;
globalThis.clearInterval = originalClearInterval;

// A deactivated session may still have an in-flight CLI overview. Resolving it after immediate
// reactivation must never overwrite the new registration's fresher submenu.
let resolveOldOverview;
const oldOverview = new Promise((resolve) => { resolveOldOverview = resolve; });
const oldUpdates = [];
const oldDispose = plugin.activate({
  actions: { registerAction() {} },
  trayMenu: { addItem() { return { update(patch) { oldUpdates.push(patch); } }; } },
  radialMenu: { addItem() {} },
  host: { aiAccounts: { getOverview() { return oldOverview; } } },
});
oldDispose();

const newUpdates = [];
const newDispose = plugin.activate({
  actions: { registerAction() {} },
  trayMenu: { addItem() { return { update(patch) { newUpdates.push(patch); } }; } },
  radialMenu: { addItem() {} },
  host: { aiAccounts: { getOverview() { return { providers: [{ provider: "codex", activeAccountId: "new", accounts: [
    { id: "new", usage: [{ kind: "five-hour", usedPercent: 20 }] },
  ] }] }; } } },
});
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(newUpdates.some((patch) => patch.submenu.some((item) => /5시간 20%/.test(item.label || ""))), "new activation must publish 20% usage");
resolveOldOverview({ providers: [{ provider: "codex", activeAccountId: "old", accounts: [
  { id: "old", usage: [{ kind: "five-hour", usedPercent: 90 }] },
] }] });
await new Promise((resolve) => setTimeout(resolve, 0));
assert.ok(!newUpdates.some((patch) => patch.submenu.some((item) => /5시간 90%/.test(item.label || ""))), "old activation must not overwrite the new tray registration");
assert.equal(oldUpdates.length, 0, "deactivated registration must not receive the late result either");
newDispose();

// DAP 1.3.5 and older return no mutable tray handle. Activation must keep the legacy direct-click
// contribution usable even though min_app_version normally prevents this install combination.
let legacyTray;
const legacyDispose = plugin.activate({
  actions: { registerAction() {} },
  trayMenu: { addItem(item) { legacyTray = item; } },
  radialMenu: { addItem() {} },
  host: { aiAccounts: { getOverview() { return { providers: [] }; } } },
});
assert.equal(legacyTray.actionId, "open-ai-usage");
legacyDispose();

const manifest = readFileSync(new URL("plugin.yaml", root), "utf8");
for (const expected of ["id: io.github.o-min222.ai_usage", "version: 0.1.7", 'min_app_version: "1.3.6"', "manifest_version: 2", "entry: dap_ai_usage.plugin:activate", "- window.palette", "- ai.accounts"]) assert.ok(manifest.includes(expected));
console.log("ok manifest, plugin module, palette script, normalization, activation bridge");
