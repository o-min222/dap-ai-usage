# DAP Host integration

AI Usage는 credential을 직접 수집하지 않는 metadata-only 플러그인입니다. 실제 계정 목록, 구독 사용량과 로그인 흐름은 DAP 앱 Host가 제공해야 합니다.

## Upstream integration points

DAP upstream에서 확인해야 할 실제 연결 지점은 다음과 같습니다.

- `app/packages/plugins/src/context.ts`
  - `HostServices`에 `aiAccounts` namespace를 추가합니다.
  - `GATED_NAMESPACES`에 계정 capability permission을 연결합니다.
- `app/electron/main/src/main.ts`
  - plugin context를 만들 때 `hostServices.aiAccounts` 구현을 주입합니다.
  - 기존 계정 설정 action과 공식 로그인 흐름을 재사용합니다.
- `app/packages/llm/src/headless-cli.ts`
  - 현재 구조처럼 이미 로그인된 공식 CLI session을 사용합니다.
  - plugin을 위해 token, cookie 또는 credential 파일을 읽어 반환하지 않습니다.

이 앱 소스는 현재 플러그인 저장소에 포함되지 않습니다. Host 변경은 `Project-Undonghae/mydeskpet`에서 별도 PR로 진행해야 합니다.

## Permission decision

manifest는 미래의 gated namespace 전달을 위해 `ai.accounts`를 미리 선언합니다. 아직 공개 Plugin Platform에 존재하지 않으므로 최종 이름과 범위는 upstream에서 확정해야 합니다. 이름이 변경되면 Host 출시 전 manifest permission도 함께 변경해야 합니다.

권장 최소 정책:

- `ai.accounts`: 계정 metadata·사용량 읽기, 공식 계정 추가 흐름 열기, 계정 설정 열기
- credential, token, cookie, raw CLI output은 반환 금지
- capability가 없거나 사용자가 permission을 승인하지 않으면 `ctx.host.aiAccounts`는 노출하지 않음

읽기와 계정 연결을 더 엄격히 분리하려면 `ai.accounts.read`와 `ai.accounts.connect` 두 permission으로 나눌 수 있습니다. 첫 공개 버전 전에 이 결정을 확정하고 manifest와 문서를 함께 갱신해야 합니다.

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

## Upstream release work

`aiAccounts`는 새 공개 Host namespace이므로 backward-compatible Plugin Platform minor 변경으로 처리해야 합니다.

1. `context.ts`에 type, permission gate와 tests 추가
2. Electron main에 Host 구현·injection과 IPC/security tests 추가
3. 기존 setup/login action을 `addAccount()`에 연결
4. 실제 로그인된 Codex/Claude 계정으로 integration tests 추가
5. `developers.html`, `docs/PLUGIN_API.md`, `docs/plugin-platform/ai-context.md` 갱신
6. Plugin Platform changelog와 version metadata minor bump
7. 새 DAP app 버전과 minimum supported version 배포
8. 지원 앱 배포 후 plugin tag와 catalog entry 공개

Host가 없는 이전 앱에서는 plugin이 안전하게 unsupported 상태를 표시해야 합니다.
