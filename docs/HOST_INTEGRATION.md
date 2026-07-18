# DAP Host integration

AI Usage는 credential을 직접 수집하지 않는 metadata-only 플러그인입니다. 실제 계정 목록, 구독 사용량과 로그인 흐름은 DAP v1.3.6 이상 앱 Host가 제공합니다.

## Released Host integration

DAP v1.3.4에 출시된 연결 지점은 다음과 같습니다.

- `app/packages/plugins/src/context.ts`
  - `HostServices`에 `aiAccounts` namespace가 추가되었습니다.
  - `GATED_NAMESPACES`에 `ai.accounts` permission이 연결되었습니다.
- `app/electron/main/src/main.ts`
  - plugin context를 만들 때 `hostServices.aiAccounts` 구현을 주입합니다.
  - 기존 계정 설정 action과 공식 로그인 흐름을 재사용합니다.
- `app/packages/llm/src/headless-cli.ts`
  - 현재 구조처럼 이미 로그인된 공식 CLI session을 사용합니다.
  - plugin을 위해 token, cookie 또는 credential 파일을 읽어 반환하지 않습니다.

기본 Host 연결은 `Project-Undonghae/mydeskpet` PR #43과 DAP v1.3.4에서 공개되었습니다. Claude Code의 5시간·주간 구독 한도 조회는 PR #44와 DAP v1.3.5에서 추가되었고, 동적 tray submenu는 DAP v1.3.6에서 추가되므로 이 플러그인의 최소 지원 버전은 v1.3.6입니다.

## Dynamic tray summary

DAP v1.3.6의 `ctx.trayMenu.addItem()` 등록 handle은 `update({ submenu })`를 제공합니다. 플러그인은
활성 service account를 우선하고 없으면 DAP account로 폴백해 Codex·Claude의 5시간·주간 행을
캐시합니다. 행과 `상세 패널 열기…`는 기존 `open-ai-usage` action으로 palette를 엽니다.

Host는 submenu를 안전한 선언형 DTO로만 받으며 action ID를 플러그인 namespace로 qualify합니다.
callback, credential, raw CLI output은 메뉴 모델에 들어가지 않습니다. 구형 Host에서 update handle이
없으면 기존 단일 `AI Usage` 클릭 동작을 유지합니다.

## Permission decision

manifest는 v1.3.4에서 공개된 gated namespace를 사용하기 위해 `ai.accounts`를 선언합니다.

공개 정책:

- `ai.accounts`: 계정 metadata·사용량 읽기, 공식 계정 추가 흐름 열기, 계정 설정 열기
- credential, token, cookie, raw CLI output은 반환 금지
- capability가 없거나 사용자가 permission을 승인하지 않으면 `ctx.host.aiAccounts`는 노출하지 않음

## Canonical API

```ts
interface AiAccountsHost {
  getOverview(): Promise<AiAccountsOverview>;
  getAccountUsage(providerId: string, accountId: string): Promise<AccountUsage>;
  addAccount(providerId: string): Promise<{ ok: boolean; accountId?: string }>;
  openAccounts(): Promise<void>;
}
```

플러그인은 migration을 위해 몇 가지 별칭을 인식하지만, upstream 구현과 문서에는 위 네 메서드만 canonical API로 공개하는 것을 권장합니다.

### `getOverview()`

모든 provider와 연결된 계정 metadata를 한 번에 반환합니다. 사용량을 함께 반환하면 계정 select가 즉시 렌더됩니다.

```ts
interface AiAccountsOverview {
  updatedAt: string;
  activeAccount?: AccountRef;
  dapAccount?: AccountRef;
  providers: AiProvider[];
}

interface AccountRef {
  providerId: string;
  accountId: string;
}

interface AiProvider {
  provider: "codex" | "claude" | string;
  name: string;
  activeAccountId?: string;
  dapActiveAccountId?: string;
  accounts: AiAccount[];
  usage?: UsageWindow[];
  updatedAt?: string;
}

interface AiAccount {
  id: string;
  email?: string;
  label?: string;
  active?: boolean;
  dapActive?: boolean;
  accountType?: "business" | "personal";
  status?: "connected" | "disconnected" | "expired" | "error";
  statusMessage?: string;
  usage?: UsageWindow[];
  updatedAt?: string;
}

interface UsageWindow {
  id?: string;
  kind?: "five-hour" | "weekly";
  label: string;
  usedPercent: number;
  resetAt?: string;
  detail?: string;
}
```

`activeAccount`는 서비스가 현재 사용하는 계정이고 `dapAccount`는 DAP headless 요청에 사용하는 계정입니다. 두 값은 같을 수도, 다를 수도 있습니다. `accountType`은 Host가 확인한 명시적 metadata만 사용하며 이메일 domain으로 추론하지 않습니다.

### `getAccountUsage(providerId, accountId)`

선택한 조회 계정의 최신 사용량을 반환합니다. palette가 보내는 request ID는 plugin bridge가 응답에 그대로 포함하므로 Host는 request ID를 해석할 필요가 없습니다.

```ts
interface AccountUsage {
  usage: UsageWindow[];
  updatedAt?: string;
}
```

이 메서드가 없으면 plugin은 `getOverview()`에 포함된 account usage만 사용합니다.

### `addAccount(providerId)`

기존 DAP 계정 설정 action 또는 공식 provider 로그인 UI를 엽니다. 성공 후 Host의 계정 목록이 갱신되어야 합니다. plugin은 token을 받지 않으며, 새 계정을 DAP 기본 계정으로 자동 변경하지 않습니다.

취소는 정상적인 사용자 결과로 취급해야 하며 민감한 원문 인증 오류를 plugin에 전달하지 않는 것이 좋습니다.

### `openAccounts()`

DAP 환경설정의 계정 섹션을 엽니다. 실제 DAP 사용 계정 변경은 palette가 아닌 이 화면에서만 수행합니다.

## Security boundary

- Host가 credential과 macOS Keychain 접근을 소유합니다.
- Host가 공식 Codex/Claude CLI 로그인 session과 subprocess lifecycle을 소유합니다.
- plugin에는 account ID, 표시 label, 상태, 사용량, reset 시각만 전달합니다.
- access token, refresh token, cookie, session file path, raw command output을 전달하지 않습니다.
- palette renderer는 sandbox message bridge만 사용하고 Host object에 직접 접근하지 않습니다.
- provider 오류는 사용자용으로 정제하고 credential 또는 filesystem path를 포함하지 않습니다.

## Release status

`aiAccounts` Host namespace는 DAP v1.3.4에서 공개되었고 Claude Code 구독 한도는 v1.3.5, 동적 tray submenu는 v1.3.6에서 추가되었습니다.

- Host type, `ai.accounts` permission gate와 broker tests가 포함되어 있습니다.
- Electron main의 계정 adapter와 Host injection이 포함되어 있습니다.
- Codex 공식 app-server와 Claude Code의 로그인된 CLI session을 사용해 구독 사용량을 조회합니다.
- `docs/PLUGIN_API.md`에 canonical API와 보안 경계가 공개되어 있습니다.
- v1.3.6 Windows/macOS 설치본에서 상단바/트레이 사용량 요약을 제공합니다.
- 플러그인은 `min_app_version: "1.3.6"`를 선언합니다.

v1.3.6 미만 앱은 동적 submenu 계약이 없으므로 업데이트가 필요합니다.
