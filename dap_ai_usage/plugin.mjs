const PALETTE_PAGE = "palette/index.html";
const TRAY_REFRESH_MS = 5 * 60 * 1000;
const PROVIDER_NAMES = {
  openai: "ChatGPT / Codex",
  chatgpt: "ChatGPT",
  codex: "Codex",
  anthropic: "Claude",
  claude: "Claude",
  cursor: "Cursor",
  google: "Gemini",
  gemini: "Gemini",
};

let palette = null;
let disposeMessages = null;
let trayRegistration = null;
let trayRefreshTimer = null;
let overviewRequest = null;
let overviewRequestGeneration = 0;
let activationGeneration = 0;

function text(value, fallback = "") {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function finite(value) {
  const parsed = typeof value === "string" ? Number.parseFloat(value) : value;
  return typeof parsed === "number" && Number.isFinite(parsed) ? parsed : null;
}

function clampPercent(value) {
  const number = finite(value);
  if (number === null) return null;
  return Math.min(100, Math.max(0, number));
}

function isoDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function providerId(raw, index) {
  return text(raw?.providerId) || text(raw?.provider) || text(raw?.id) || `provider-${index + 1}`;
}

function usageWindows(raw) {
  const values = Array.isArray(raw?.usage) ? raw.usage
    : Array.isArray(raw?.limits) ? raw.limits
      : raw?.usage && typeof raw.usage === "object"
        ? Object.entries(raw.usage).map(([label, value]) => ({ label, ...(typeof value === "object" ? value : { usedPercent: value }) })) : [];
  const normalized = values.map((item, index) => {
    const explicitUsed = finite(item?.used);
    const explicitLimit = finite(item?.limit ?? item?.total);
    let usedPercent = clampPercent(item?.usedPercent ?? item?.percent ?? item?.percentage);
    if (usedPercent === null && explicitUsed !== null && explicitLimit !== null && explicitLimit > 0) usedPercent = clampPercent((explicitUsed / explicitLimit) * 100);
    const remainingPercent = clampPercent(item?.remainingPercent);
    if (usedPercent === null && remainingPercent !== null) usedPercent = 100 - remainingPercent;
    const label = text(item?.label) || text(item?.name) || text(item?.window) || "사용량";
    const rawKind = (text(item?.kind) || text(item?.period) || text(item?.windowType)).toLowerCase();
    const classification = `${text(item?.id).toLowerCase()} ${label.toLowerCase()}`;
    const kind = /^(five|5)[\s_-]*(hours?|hrs?|h)$/.test(rawKind) ? "five-hour"
      : /^(weekly|week)$/.test(rawKind) ? "weekly"
        : /(?:5|five)\s*[-–—_]?\s*(?:시간|hours?|hrs?|h\b)/.test(classification) ? "five-hour"
          : /주간|\bweekly\b|\bweek\b|7\s*[-–—_]?\s*(?:일|days?\b)/.test(classification) ? "weekly" : null;
    return { id: text(item?.id, `usage-${index + 1}`), label, kind, usedPercent, used: explicitUsed, limit: explicitLimit, unit: text(item?.unit), resetAt: isoDate(item?.resetAt ?? item?.resetsAt ?? item?.resetTime), detail: text(item?.detail) || text(item?.description) };
  });
  return [normalized.find((item) => item.kind === "five-hour"), normalized.find((item) => item.kind === "weekly")].filter(Boolean);
}

function mergeUsageSlots(primary, fallback) {
  const primaryItems = Array.isArray(primary) ? primary : [];
  const fallbackItems = Array.isArray(fallback) ? fallback : [];
  return ["five-hour", "weekly"].map((kind) => (
    primaryItems.find((item) => item.kind === kind) || fallbackItems.find((item) => item.kind === kind)
  )).filter(Boolean);
}

function normalizedAccountType(item) {
  const explicit = text(item?.accountType) || text(item?.profileType) || text(item?.organizationType) || text(item?.accountKind);
  const value = explicit.toLowerCase();
  if (["business", "company", "organization", "work", "team", "enterprise"].includes(value)) return "business";
  if (["personal", "individual", "consumer"].includes(value)) return "personal";
  if (explicit) return null;
  if (item?.isBusiness === true) return "business";
  if (item?.isPersonal === true) return "personal";
  return null;
}

export function normalizeProvider(raw, index = 0) {
  const source = raw && typeof raw === "object" ? raw : {};
  const id = providerId(source, index);
  const account = source.account && typeof source.account === "object" ? source.account : {};
  const accountId = text(source.accountId) || text(account.id) || text(source.profileId);
  const activeAccountId = text(source.activeAccountId) || text(source.serviceActiveAccountId) || accountId;
  const dapActiveAccountId = text(source.dapActiveAccountId) || text(source.dapAccountId);
  const email = text(source.email) || text(account.email) || text(source.username) || text(account.name);
  const error = text(source.error?.message) || text(source.error) || text(source.message);
  const sourceStatus = text(source.status).toLowerCase();
  const authExpired = source.authExpired === true || sourceStatus === "expired" || sourceStatus === "auth_expired";
  const connected = source.connected === true || source.loggedIn === true || sourceStatus === "connected" || Boolean(accountId || email);
  const updatedAt = isoDate(source.updatedAt ?? source.fetchedAt);
  const accounts = Array.isArray(source.accounts) ? source.accounts.map((item) => {
    const itemId = text(item?.id) || text(item?.accountId) || text(item?.profileId);
    const itemAccountId = text(item?.accountId) || itemId;
    const status = text(item?.status).toLowerCase();
    const itemError = text(item?.error?.message) || text(item?.error) || text(item?.message);
    const expired = item?.authExpired === true || status === "expired" || status === "auth_expired";
    const itemUpdatedAt = isoDate(item?.updatedAt ?? item?.fetchedAt);
    return {
      id: itemId, accountId: itemAccountId, email: text(item?.email), label: text(item?.email) || text(item?.name) || text(item?.label) || "계정",
      active: activeAccountId ? itemId === activeAccountId || itemAccountId === activeAccountId : item?.active === true || item?.isActive === true || item?.serviceActive === true,
      dapActive: dapActiveAccountId ? itemId === dapActiveAccountId || itemAccountId === dapActiveAccountId : item?.dapActive === true || item?.usedByDap === true || item?.dapHeadless === true || item?.headlessActive === true || item?.isDapAccount === true,
      accountType: normalizedAccountType(item),
      connected: item?.connected !== false && item?.loggedIn !== false && status !== "disconnected" && !expired,
      status: itemError ? "error" : expired ? "auth-expired" : status || "connected",
      statusMessage: itemError || text(item?.statusMessage) || (expired ? "인증 만료 — 다시 로그인 필요" : "연결됨"),
      usage: usageWindows(item), updatedAt: itemUpdatedAt,
      stale: item?.stale === true || Boolean(itemUpdatedAt && Date.now() - new Date(itemUpdatedAt).getTime() > 30 * 60 * 1000),
    };
  }).filter((item) => item.id) : [];
  const activeAccounts = accounts.filter((item) => item.active);
  for (const item of activeAccounts.slice(1)) item.active = false;
  if (!activeAccountId && (source.active === true || source.isActive === true || account.active === true) && !accounts.some((item) => item.active)) {
    const matching = email ? accounts.filter((item) => item.email === email || item.label === email) : [];
    if (accounts.length === 1) accounts[0].active = true;
    else if (matching.length === 1) matching[0].active = true;
  }
  return {
    id, name: text(source.name) || text(source.providerName) || PROVIDER_NAMES[id.toLowerCase()] || id, icon: text(source.icon), connected,
    status: error ? "error" : authExpired ? "auth-expired" : connected ? "connected" : "disconnected",
    statusMessage: error || text(source.statusMessage) || (authExpired ? "인증 만료 — 다시 로그인 필요" : connected ? "연결됨" : "로그인 확인 필요"),
    accountId, email, active: accounts.length === 0 && (source.active === true || source.isActive === true || source.serviceActive === true || account.active === true),
    dapActive: accounts.length === 0 && (source.dapActive === true || source.usedByDap === true || source.dapHeadless === true || source.headlessActive === true || source.isDapAccount === true),
    accountType: normalizedAccountType(source),
    canSwitch: false, accounts, usage: usageWindows(source), updatedAt,
    stale: Boolean(source.stale === true || (updatedAt && Date.now() - new Date(updatedAt).getTime() > 30 * 60 * 1000)),
  };
}

export function normalizeOverview(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const list = Array.isArray(raw) ? raw : Array.isArray(source.providers) ? source.providers : Array.isArray(source.accounts) ? source.accounts : [];
  const providers = list.map(normalizeProvider);
  const topActive = source.activeAccount && typeof source.activeAccount === "object" ? source.activeAccount : null;
  const topDap = source.dapAccount && typeof source.dapAccount === "object" ? source.dapAccount : null;
  if (topActive) {
    const topProviderId = text(topActive.providerId) || text(topActive.provider);
    const topAccountId = text(topActive.accountId) || text(topActive.id) || text(topActive.profileId);
    const provider = providers.find((item) => item.id === topProviderId);
    if (provider) {
      provider.active = !provider.accounts.length && (!topAccountId || provider.accountId === topAccountId);
      for (const item of provider.accounts) item.active = item.id === topAccountId || item.accountId === topAccountId;
    }
  }
  if (topDap) {
    const dapProviderId = text(topDap.providerId) || text(topDap.provider);
    const dapAccountId = text(topDap.accountId) || text(topDap.id) || text(topDap.profileId);
    for (const item of providers) {
      item.dapActive = false;
      for (const accountItem of item.accounts) accountItem.dapActive = false;
    }
    const provider = providers.find((item) => item.id === dapProviderId);
    if (provider) {
      provider.dapActive = !provider.accounts.length && (!dapAccountId || provider.accountId === dapAccountId);
      const dapAccount = provider.accounts.find((item) => item.id === dapAccountId || item.accountId === dapAccountId);
      if (dapAccount) dapAccount.dapActive = true;
    }
  }
  for (const provider of providers) {
    for (const item of provider.accounts) {
      if (item.active) item.usage = mergeUsageSlots(item.usage, provider.usage);
    }
  }
  const topProviderId = topActive ? text(topActive.providerId) || text(topActive.provider) : "";
  const topProvider = providers.find((provider) => provider.id === topProviderId);
  const topAccountId = topActive ? text(topActive.accountId) || text(topActive.id) || text(topActive.profileId) : "";
  const topAccountFound = !topActive || Boolean(topProvider && (
    topProvider.accounts.some((item) => item.active && (!topAccountId || item.id === topAccountId || item.accountId === topAccountId))
    || (topProvider.active && !topProvider.accounts.length)
  ));
  const dapProviderId = topDap ? text(topDap.providerId) || text(topDap.provider) : "";
  const dapProvider = providers.find((provider) => provider.id === dapProviderId);
  const dapAccountId = topDap ? text(topDap.accountId) || text(topDap.id) || text(topDap.profileId) : "";
  const topDapFound = !topDap || Boolean(dapProvider && (
    dapProvider.accounts.some((item) => item.dapActive && (item.id === dapAccountId || item.accountId === dapAccountId))
    || (dapProvider.dapActive && !dapProvider.accounts.length)
  ));
  const warning = !topAccountFound ? "Host가 보고한 현재 사용 계정을 목록에서 찾지 못했습니다."
    : !topDapFound ? "Host가 보고한 DAP 사용 계정을 목록에서 찾지 못했습니다." : null;
  return { providers, updatedAt: isoDate(source.updatedAt) || new Date().toISOString(), warning };
}

function accountCapability(ctx) {
  const host = ctx?.host;
  if (!host) return null;
  return host.aiAccounts || host.accounts || null;
}

async function callFirst(accountHost, names, args = []) {
  for (const name of names) {
    if (typeof accountHost?.[name] === "function") return accountHost[name](...args);
  }
  return undefined;
}

function unsupportedOverview(message = "이 DAP 버전은 AI 계정 상태 조회를 지원하지 않습니다.") {
  return {
    providers: [],
    updatedAt: new Date().toISOString(),
    unsupported: true,
    message,
  };
}

async function loadOverview(ctx) {
  const accountHost = accountCapability(ctx);
  if (!accountHost) return unsupportedOverview();
  try {
    const raw = await callFirst(accountHost, ["getUsageOverview", "getOverview", "getStatuses", "listProviders", "list"]);
    if (raw === undefined) return unsupportedOverview("계정 capability에 사용량 조회 기능이 없습니다.");
    const overview = normalizeOverview(raw);
    const canAdd = ["addAccount", "connectAccount", "loginAccount"].some((name) => typeof accountHost[name] === "function");
    const canQueryUsage = typeof accountHost.getAccountUsage === "function";
    const settingsHost = ctx?.host?.settings;
    const canOpenSettings = [accountHost, settingsHost].some((target) => ["openAccounts", "openSettings", "open"].some((name) => typeof target?.[name] === "function"));
    overview.providers = overview.providers.map((provider) => ({
      ...provider,
      canAdd, canOpenSettings, canQueryUsage,
    }));
    return overview;
  } catch (error) {
    return {
      ...unsupportedOverview("계정 상태를 불러오지 못했습니다."),
      unsupported: false,
      error: text(error?.message, "알 수 없는 오류"),
    };
  }
}

function activeUsageSource(provider) {
  if (!provider) return null;
  if (provider.accounts.length) {
    const account = provider.accounts.find((item) => item.active) || provider.accounts.find((item) => item.dapActive);
    return account ? { ...account, usage: mergeUsageSlots(account.usage, provider.usage) } : null;
  }
  return provider.active || provider.dapActive ? provider : null;
}

function resetLabel(item) {
  if (!item?.resetAt) return "";
  const date = new Date(item.resetAt);
  if (Number.isNaN(date.getTime())) return "";
  const options = item.kind === "weekly"
    ? { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit" }
    : { hour: "2-digit", minute: "2-digit" };
  return ` · ${new Intl.DateTimeFormat("ko-KR", options).format(date)} 초기화`;
}

function percentLabel(value) {
  return value === null || value === undefined ? "—" : `${Number(value.toFixed(1))}%`;
}

/** Build a bounded, declarative tray submenu from sanitized overview metadata. */
export function buildTraySubmenu(overview) {
  if (overview?.error || overview?.unsupported) {
    return [
      { itemId: "error", label: text(overview.error) || text(overview.message, "사용량을 불러오지 못했습니다."), enabled: false },
      { itemId: "separator", type: "separator" },
      { itemId: "details", label: "상세 패널 열기…", actionId: "open-ai-usage", enabled: true },
    ];
  }
  const rows = [];
  for (const providerKey of ["codex", "claude"]) {
    const provider = overview?.providers?.find((item) => item.id.toLowerCase() === providerKey);
    const account = activeUsageSource(provider);
    if (!provider || !account) continue;
    const dap = account.dapActive === true || provider.dapActive === true;
    const prefix = `${provider.name}${dap ? " (DAP)" : ""}`;
    for (const [kind, windowLabel] of [["five-hour", "5시간"], ["weekly", "주간"]]) {
      const usage = account.usage.find((item) => item.kind === kind);
      rows.push(usage ? {
        itemId: `${providerKey}-${kind}`,
        label: `${prefix} · ${windowLabel} ${percentLabel(usage.usedPercent)}${resetLabel(usage)}`,
        actionId: "open-ai-usage",
        enabled: true,
      } : {
        itemId: `${providerKey}-${kind}`,
        label: `${prefix} · ${windowLabel} —`,
        enabled: false,
      });
    }
  }
  if (!rows.length) rows.push({ itemId: "empty", label: "활성 Codex/Claude 계정이 없습니다.", enabled: false });
  return [
    ...rows,
    { itemId: "separator", type: "separator" },
    { itemId: "details", label: "상세 패널 열기…", actionId: "open-ai-usage", enabled: true },
  ];
}

function updateTray(overview, generation) {
  if (generation !== activationGeneration) return;
  if (typeof trayRegistration?.update === "function") trayRegistration.update({ submenu: buildTraySubmenu(overview) });
}

async function requestOverview(ctx, fresh = false, generation = activationGeneration) {
  if (generation !== activationGeneration) return unsupportedOverview("플러그인 세션이 종료되었습니다.");
  // Account-add/manual palette refreshes must not reuse a request that started before the change.
  if (fresh && overviewRequest && overviewRequestGeneration === generation) await overviewRequest;
  if (generation !== activationGeneration) return unsupportedOverview("플러그인 세션이 종료되었습니다.");
  if (!overviewRequest || overviewRequestGeneration !== generation) {
    const request = loadOverview(ctx);
    const tracked = request.finally(() => {
      if (overviewRequest === tracked) {
        overviewRequest = null;
        overviewRequestGeneration = 0;
      }
    });
    overviewRequest = tracked;
    overviewRequestGeneration = generation;
  }
  return overviewRequest;
}

async function refreshTraySummary(ctx, fresh = false, generation = activationGeneration) {
  const overview = await requestOverview(ctx, fresh, generation);
  updateTray(overview, generation);
  return overview;
}

function post(message, generation) {
  if (generation !== activationGeneration) return;
  if (palette && typeof palette.postMessage === "function") palette.postMessage(message);
}

async function refresh(ctx, generation) {
  post({ type: "loading" }, generation);
  post({ type: "overview", ...(await refreshTraySummary(ctx, true, generation)) }, generation);
}

async function requestAccountUsage(ctx, message, generation) {
  const providerIdValue = text(message?.providerId);
  const accountId = text(message?.accountId);
  const accountHost = accountCapability(ctx);
  if (!providerIdValue || !accountId || typeof accountHost?.getAccountUsage !== "function") return;
  try {
    const raw = await accountHost.getAccountUsage(providerIdValue, accountId);
    post({ type: "account-usage", requestId: message?.requestId, providerId: providerIdValue, accountId, usage: usageWindows({ usage: raw?.usage ?? raw?.limits ?? raw }) }, generation);
  } catch (error) {
    post({ type: "account-usage", requestId: message?.requestId, providerId: providerIdValue, accountId, error: text(error?.message, "사용량을 조회하지 못했습니다.") }, generation);
  }
}

async function requestAddAccount(ctx, message, generation) {
  const providerIdValue = text(message?.providerId);
  const accountHost = accountCapability(ctx);
  const method = ["addAccount", "connectAccount", "loginAccount"].find((name) => typeof accountHost?.[name] === "function");
  if (!providerIdValue || !method) {
    post({ type: "add-result", providerId: providerIdValue, ok: false, message: "이 DAP 버전은 계정 추가를 지원하지 않습니다." }, generation);
    return;
  }
  try {
    const result = await accountHost[method](providerIdValue);
    if (result === false || result?.ok === false) throw new Error(text(result?.message, "계정 추가가 취소되었습니다."));
    post({ type: "add-result", providerId: providerIdValue, ok: true, message: "계정 추가를 완료했습니다." }, generation);
  } catch (error) {
    post({ type: "add-result", providerId: providerIdValue, ok: false, message: text(error?.message, "계정을 추가하지 못했습니다.") }, generation);
  }
  await refresh(ctx, generation);
}

async function openAccountSettings(ctx, generation) {
  const targets = [accountCapability(ctx), ctx?.host?.settings];
  for (const target of targets) {
    const method = ["openAccounts", "openSettings", "open"].find((name) => typeof target?.[name] === "function");
    if (!method) continue;
    try {
      await target[method]("accounts");
      post({ type: "settings-result", ok: true, message: "DAP 계정 설정을 열었습니다." }, generation);
      return;
    } catch (error) {
      post({ type: "settings-result", ok: false, message: text(error?.message, "계정 설정을 열지 못했습니다.") }, generation);
      return;
    }
  }
  post({ type: "settings-result", ok: false, message: "이 DAP 버전은 계정 설정 열기를 지원하지 않습니다." }, generation);
}

function alive(handle) {
  return Boolean(handle) && !(typeof handle.isDestroyed === "function" && handle.isDestroyed());
}

function openPalette(ctx, generation) {
  if (generation !== activationGeneration) return;
  if (alive(palette)) {
    if (typeof palette.show === "function") palette.show();
    if (typeof palette.focus === "function") palette.focus();
    refresh(ctx, generation);
    return;
  }
  const windows = ctx?.host?.windows;
  if (!windows || typeof windows.openPalette !== "function") {
    try { ctx?.host?.bubble?.speak("AI 사용량 창을 열려면 DAP 팔레트 지원이 필요해요."); } catch { /* best-effort */ }
    return;
  }
  palette = windows.openPalette({
    page: PALETTE_PAGE,
    width: 420,
    height: 620,
    frame: false,
  });
  try {
    if (typeof palette?.setAlwaysOnTop === "function") palette.setAlwaysOnTop(true, "pop-up-menu");
  } catch { /* window stacking is best-effort */ }
  if (palette && typeof palette.onMessage === "function") {
    disposeMessages = palette.onMessage((message) => {
      if (!message || typeof message !== "object") return;
      if (message.type === "ready" || message.type === "refresh") refresh(ctx, generation);
      else if (message.type === "query-account-usage") requestAccountUsage(ctx, message, generation);
      else if (message.type === "add-account") requestAddAccount(ctx, message, generation);
      else if (message.type === "open-account-settings") openAccountSettings(ctx, generation);
    });
  }
  if (typeof palette?.show === "function") palette.show();
}

export function activate(ctx) {
  const generation = ++activationGeneration;
  ctx.actions.registerAction({ id: "open-ai-usage", callback: () => openPalette(ctx, generation) });
  const registration = ctx.trayMenu.addItem({
    itemId: "ai-usage",
    label: "AI 계정 사용량",
    actionId: "open-ai-usage",
    showInContextMenu: true,
    priority: 60,
    submenu: [
      { itemId: "loading", label: "사용량 불러오는 중…", enabled: false },
      { itemId: "separator", type: "separator" },
      { itemId: "details", label: "상세 패널 열기…", actionId: "open-ai-usage", enabled: true },
    ],
  });
  trayRegistration = registration;
  ctx.radialMenu.addItem({ itemId: "ai-usage", label: "AI 사용량", actionId: "open-ai-usage", priority: 60 });
  void refreshTraySummary(ctx, false, generation);
  const refreshTimer = setInterval(() => void refreshTraySummary(ctx, false, generation), TRAY_REFRESH_MS);
  trayRefreshTimer = refreshTimer;
  if (typeof refreshTimer?.unref === "function") refreshTimer.unref();

  return () => {
    clearInterval(refreshTimer);
    if (generation !== activationGeneration) return;
    activationGeneration += 1;
    trayRefreshTimer = null;
    trayRegistration = null;
    if (overviewRequestGeneration === generation) {
      overviewRequest = null;
      overviewRequestGeneration = 0;
    }
    if (typeof disposeMessages === "function") disposeMessages();
    disposeMessages = null;
    if (alive(palette) && typeof palette.close === "function") palette.close();
    palette = null;
  };
}
