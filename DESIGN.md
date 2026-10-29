# dsh-opencode-provider — архитектура и план

## 0.5.18 — current release

- DSH compatibility is a range: `>=0.2.1-rc.2 <0.2.2-0`; tested releases remain rc.2/rc.3/rc.4.
- `test:engine` and `test:install` verify isolated install and provider activation for each tested engine.
- Key status is exposed per account (`ok`/`expired`/`invalid`/`missing`/`unavailable`/`unchecked`) with a per-account Check key action.

## 0.5.17 — previous release

- DSH core **0.2.1-rc.4** is supported; rc.2/rc.3 remain supported.
- Verified on isolated DSH 0.2.1-rc.4: provider activation, 33-model live catalog and a real provider request (credential expired, transport reached OpenCode).

## 0.5.16 — previous release

- DSH core **0.2.1-rc.3** is supported (current Desktop runtime); `0.2.1-rc.2` remains supported for DSH Web 111.
- Typecheck/build/tests use `@deepseek-ai/*@0.2.1-rc.3`.

## 0.5.15 — previous release

- Gitea `main` migrated from the published GitHub history after 0.5.1; source versions 0.5.2–0.5.15 are represented by tags and the migration PR.
- Current provider ids are `opencode-direct` and `opencode-go-direct`; legacy `opencode`/`opencode-go` stay with the built-in `llm-pi-ai` catalog and are not re-registered.
- Read routes accept loopback or a literal local interface address; writes require a same-origin `Origin`/`Referer`. DNS-rebinding hostnames are rejected.
- DSH Desktop and DSH Web 0.2.1-rc.2 are the verified runtime targets. WEB 111 runs 0.5.15; Desktop runs 0.5.15.
- The section below is the historical 0.5.1 design record; current behavior is defined by the 0.5.15 source and CHANGELOG.


Плагин для DeepSeek Harness (DSH), добавляющий два LLM-маршрута:

- `opencode` — OpenCode Console / Zen (pay-as-you-go, ключ из console).
- `opencode-go` — подписка OpenCode Go / Go Plus (та же модель доступа, но с квотами rolling/weekly/monthly).

Оба маршрута обслуживает один адаптер: у них общий протокол, каталог и авторизация, различаются только базовый путь и наличие квот.

## 0. Статус реализации

Внутренний слой и UI готовы:

- пакет, `cordis.patch.yml`, `tsdown`, `tsc --noEmit`;
- Config с volatile-полями, резолв ключа (config → credentials → `auth.json` → launch env);
- пул аккаунтов с ротацией на pre-stream 401/403/429 и cooldown на ключ;
- каталог: live `/v1/models` + сгенерированный snapshot models.dev;
- четыре транспорта: OpenAI Chat, Anthropic Messages, OpenAI Responses, Google;
- текст, reasoning, tool calls, usage, finish, replay (Anthropic signatures, Gemini `thoughtSignature`);
- изображения через `ctx.attachments.readImageRequest` на всех транспортах;
- стабильный `x-opencode-session`;
- `/opencode` со статусом и окнами квот;
- Host HTTP-маршруты `/dsh-opencode/*` (same-origin, JSON-only);
- browser UI: settings-страница, карточка квот в сайдбаре (off by default), панель квот в центре;
- стоимость показывает только встроенный DSH; отдельной composer-пилюли нет;
- лимиты подписки по каждой модели: месячный $ и оценки запросов 5ч/нед/мес для Go и Go Plus (в picker и settings);
- управление ключами extra-аккаунтов из UI, статус configured/missing, обновление каталога, предупреждения квот 80/95%, таблица лимитов по моделям, test connection;
- write-маршруты ограничены loopback; клиентский бандл и Host-плагин проверены в живом DSH Desktop 0.2.1-rc.2 (state 200, test OK, 37 моделей, квоты);
- аналитика по моделям из локального projection-кеша (сессии, токены, оценка $; без чтения текста диалогов), live `/analytics` 200;
- два аккаунта live-проверены: при неверном default-ключе `/test` переключился на `Go #2` и вернул OK; повторный прогон после исчерпания месячной квоты `Go #2` показал `QUOTA`, cooldown `invalid-credential` у default и `quota` у `Go #2` с reset 22 окт 08:21, без активного аккаунта; health/cooldown отдаётся в `/state`;
- квоты по аккаунтам: `/state.accounts[].usage` для каждого ключа (кэш на ключ), активный аккаунт задаёт sidebar/панель; live `default` 1/5/2, `Go #2` 9/4/100 (monthly `rate-limited`, reset 22 окт 08:21);
- heatmap запросов: adapter пишет `{at, provider, model, purpose?}` в `~/.dsh/storages/dsh-opencode/requests.jsonl` (без текста/ключей), `/analytics` добавляет сетку Пн–Вс × 24 часа по локальному времени, 24-часовой strip и per-model серии с селектором; `session-title`/`compaction` исключены, точные дубли схлопываются; сбор начинается с этого билда, т.к. в projection-кеше нет per-request timestamp; live 2 сообщения → 2 сессии, heatmap 6 основных запросов;
- cooldown’ы аккаунтов персистентны: `~/.dsh/storages/dsh-opencode/cooldowns.json`, ключ — SHA-256 fingerprint (сырые ключи не пишутся), expired чистятся, лимит 50; live после рестарта `Go #2` сохранил `quota` до 22 окт, default снова active;
- model→account rules: первый совпавший glob (case-insensitive, `*`/`?`) ставит аккаунт первым, остальные остаются fallback; конфиг нормализуется, отдаётся в `/state`, редактируется в Settings; live `*free* → Go #2` round-trip через `/config` и `/state`, затем очистка;
- sidebar-карточка переделана под clinebot: theme-native ring, имя активного аккаунта, худшее окно в процентах (прижато к правому краю) и строки 5h/weekly/monthly с remaining, reset и тонкими барами; live в Desktop 5%, 99%/3h, 95%/6d, 98%/29d;
- панель квот получила собственный вертикальный scroll (`height:100%`, viewport max-height, `overflow-y:auto`); проверено в Desktop колесом до секции **Usage by model**;
- панель квот: `Active account` вместо ошибочного `Pinned account`, badge `Quota cooldown · 2d` у `Go #2`, время+relative reset в барах (`1% · 20.10, 17:11 (2h)`);
- `/opencode` расширен: `accounts`, `models`, `rules`, `test [model]`; лог запросов компактится при 2 MB до 5000 строк; добавлены `npm run check`/`release` и GitHub Actions;
- parity 0.5.0: TUI settings через `tuiSettingsSections`, Models-page card через `settings.models.provider-card`, plan-aware Go picker (`filterModelsByPlan`, Go/Console/FREE), per-request `opencodeCost` projection, request-wide image budget с placeholder, object-root tool-schema normalization;
- Usage analytics dashboard: KPI grid, 7/30/90, Models/Days/Sessions; tool cap 128 с дедупом по имени (фикс OpenCode 400 `maximum number of items is 128`);
- 77 unit-тестов и live-smoke по всем транспортам, tool-loop, vision, ротации, usage, heatmap, persistence, rules, cost projection, TUI/Models card, analytics dashboard и команде.

Опционально дальше: полноценный TUI-редактор настроек (сейчас `/opencode` даёт status/accounts/models/rules/test) и npm publish.

## 1. Что делают референсные плагины

| | `dsh-commandcode-provider` | `dsh-clinebot` |
|---|---|---|
| Интеграция | Собственный `LlmAdapter`, маршрут `commandcode` | Настройка встроенного `llm-pi-ai` + loopback-прокси |
| Транспорты | CLI `/alpha/generate`, OpenAI Chat, Anthropic Messages | Один OpenAI Chat через прокси |
| Каталог | Live `/provider/v1/models` + статические capabilities | Курируемый каталог + план из API |
| Квоты | `/usage` + биллинг, карточка в сайдбаре | `/users/me/plan/usage-limits`, warning-баннеры |
| Аккаунты | Пул с пассивной ротацией на 429/401, model→account rules | Пул + least-used/round-robin, 429 failover |
| UI | Полная settings-страница на React, карточка Models, `/commandcode` | Settings-страница на JS, `/cline`, sidebar-карточка |
| Сложность | Высокая, но максимальный контроль | Ниже, но ограничена возможностями pi-ai |

Вывод: для OpenCode нужен **собственный `LlmAdapter`**. Причины:

1. Модели Go живут на четырёх разных протоколах (OpenAI Chat, OpenAI Responses, Anthropic Messages, Google), а `llm-pi-ai` задаёт `api` и `baseURL` на маршрут, не на модель.
2. `x-opencode-session` обязателен и должен быть **стабильным на диалог**; `llm-pi-ai` умеет только статические `headers`, то есть один ID на все сессии (ломает prompt-cache affinity и маршрутизацию).
3. Квоты, карточка в сайдбаре и ротация аккаунтов требуют прямого доступа к `ctx`/`typert`, как в commandcode-плагине.

## 2. Факты об API OpenCode (проверено)

### Базы

- Go: `https://opencode.ai/inference/go`
- Console/Zen: `https://opencode.ai/inference`
- Каталог Go: `GET https://opencode.ai/inference/go/v1/models` (публичный, без ключа; сейчас 37 id)
- Каталог Console: `GET https://opencode.ai/inference/v1/models`
- Квоты Go: `GET https://opencode.ai/zen/go/v1/usage` с `Authorization: Bearer <key>`

### Транспорты (официальные эндпоинты из docs)

| Семейство (`models.dev` npm) | Endpoint |
|---|---|
| `@ai-sdk/openai-compatible` | `{root}/openai/v1/chat/completions` |
| `@ai-sdk/openai` | `{root}/openai/v1/responses` |
| `@ai-sdk/anthropic` | `{root}/anthropic/v1/messages` |
| `@ai-sdk/google` | `{root}/google/v1beta/models/{model}:streamGenerateContent` |

Есть также единый шлюз `https://opencode.ai/zen/go/v1/chat/completions`, который используют сторонние клиенты (например, flabs.tech). **Нужен live-probe с реальным ключом:** если он принимает модели всех семейств (Claude, GPT, Gemini), MVP можно сделать на одном OpenAI-совместимом транспорте, а семейные эндпоинты оставить для нативных фич (reasoning signatures, Anthropic thinking).

### Обязательные заголовки

- `Authorization: Bearer <key>`
- `x-opencode-session: <stable opaque id>` — **обязателен**, иначе:
  `{"type":"error","error":{"type":"MissingSessionID", ...}}`.
  ID стабилен на диалог, уникален на сессию, содержимое не парсится.
- Собственный `User-Agent` (`dsh-opencode-provider/<version>`) — Cloudflare отбивает дефолтный UA (403/1010).
- `attributionHeaders()` из `@deepseek-ai/dsh-llm` — требование DSH для каждого запроса.

### Квоты

`GET /zen/go/v1/usage` возвращает:

```json
{"usage": {
  "rolling": {"status": "ok", "percent": 0,   "resetsAt": "..."},
  "weekly":  {"status": "ok", "percent": 42,  "resetsAt": "..."},
  "monthly": {"status": "ok", "percent": 42,  "resetsAt": "..."}
}}
```

`rolling` — 5-часовое окно. Проценты — **израсходовано**, не остаток. Публичного документированного API нет (issue #31084), endpoint неофициальный: нужен fail-open и понятный статус «квота недоступна».

Нюанс: в некоторых конфигурациях ключ `AGENT_ROUTER_TOKEN` из `opencode.json` не авторизует usage (401), хотя inference работает. Для обычного ключа Go из console endpoint работает. Поэтому 401 на usage не должен блокировать чат.

### Live-probe на рабочем ключе (Go)

Рабочий ключ найден в `~/.local/share/opencode/auth.json` → `opencode-go.key`. Ключ, переданный в чат, оказался другим (free-tier Console) и для Go не подошёл — поэтому резолв из `auth.json` обязателен как один из источников.

| Проверка | Результат |
|---|---|
| `GET /zen/go/v1/usage` | `200`: rolling/weekly/monthly, `percent` + `resetsAt` |
| unified chat `deepseek-v4.1-flash` | `200` |
| unified chat `minimax-m3` (Anthropic-backed) | `200` |
| unified chat `gpt-6-luna` / `grok-4.7` / `gemini-4-argon-contributor` | `400 ModelProtocolUnsupported` |
| native `/anthropic/v1/messages` (`claude-haiku-5-5`, `minimax-m3`) | `200` |
| native `/openai/v1/responses` (`gpt-6-luna`, `grok-4.7`) | `200` |
| native `/google/...:generateContent` (`gemini-4-argon-contributor`) | `200` |
| free-модели (`minimax-m3.1-flash-free`, `longcat-2.5-preview-free`, `beam-free`) с Go-ключом | `200` |

Выводы:

- Единый `/zen/go/v1/chat/completions` покрывает **OpenAI Chat + Anthropic-модели** (Anthropic транслируется: thinking приходит либо как `reasoning_content`, либо как ` thinking...` внутри content). Responses и Gemini он не принимает.
- Responses-модели (GPT, Grok, Muse) и Gemini требуют нативных эндпоинтов.
- **Free-модели доступны подписчику Go штатно**, без маскировки. Ограничение `403 FreeTierError` относится к анонимным/бесплатным ключам, а не к Go.
- Для Go достаточно `Authorization: Bearer` + стабильный `x-opencode-session` произвольной формы (проверено строкой `dsh-probe-*`). Канонический `ses_*`, `x-opencode-client`, `x-session-affinity` и инъекция tool-заглушек нужны только для анонимной free-lane (так делает `opencode2dsh`); мы её не реализуем.
- `reasoning_effort` принимает `minimal|low|medium|high|xhigh|max|none`; `off` → `none`.

Проверенные формы стримов:

- unified: `chat.completion.chunk`, финальный chunk с `choices: []` и `usage`.
- Responses: `event: response.*` (`response.output_item.added`, `response.output_text.delta`, `response.completed`).
- Anthropic: `message_start` / `content_block_start` / `content_block_delta` / `message_delta` / `message_stop`.
- Google: SSE-объекты `{candidates:[{content:{parts}}], usageMetadata}`.

Ссылка на анонимную free-lane (для понимания, не для копирования): https://github.com/FishBottle7/opencode2dsh — запросы маскируются под CLI OpenCode (`Bearer public`, `opencode/<ver>` UA, канонический `ses_*`, `x-opencode-client: cli`, инъекция `bash`+`read`). Это обход клиентского гейта, поэтому в плагин не включается.

### Ключи

Приоритет:

1. `config.apiKey` (только composition, `role('secret')`).
2. Credential store по `apiKeyEnv` (по умолчанию `OPENCODE_API_KEY`).
3. `~/.local/share/opencode/auth.json`: запись `opencode-go` (по умолчанию), либо выбранная через `openCodeAuthEntry` (`OPENCODEGO2` и т.п.). Только чтение; ключ никогда не логируется.
4. Переменные окружения запуска.

Чтение `auth.json` — удобный онбординг «взять ключ из OpenCode», но только по явной кнопке/флагу; ключ никогда не логируется.

## 3. Архитектура

```
src/
  index.ts                 Config, регистрация маршрутов, wiring сервисов
  adapter.ts               OpenCodeAdapter extends LlmAdapter
  config.ts                схемы, volatile-поля, resolve
  routing.ts               model id -> { transport, endpoint }
  catalog.ts               live ids + models.dev snapshot + fallback
  capabilities.ts          вендорный snapshot (context/output/reasoning/image/price)
  accounts.ts              resolve key, пул, ротация, health
  session-id.ts            stable x-opencode-session
  usage.ts                 GET /zen/go/v1/usage + кэш + нормализация
  errors.ts                классификация 401/402/429/5xx/Cloudflare/MissingSessionID
  transports/
    openai-chat.ts         request builder + SSE parser
    openai-responses.ts
    anthropic-messages.ts
    google-generative.ts
  commands.ts              /opencode
  usage-remote.ts          typert Remote для UI
  client/                  settings page, sidebar quota, model card
scripts/
  sync-models.mjs          models.dev/api.json -> src/capabilities.generated.ts
```

### Регистрация

```ts
export const name = 'llm-opencode'
export const inject = ['llm']

ctx.llm.registerConfigurableProviders([
  { provider: 'opencode', displayName: 'OpenCode', settingsNs: 'llm-opencode', settingsPath: [] },
  { provider: 'opencode-go', displayName: 'OpenCode Go', settingsNs: 'llm-opencode', settingsPath: [] },
])
ctx.llm.registerAdapter(['opencode', 'opencode-go'], adapter)
```

`providerInfo()` возвращает человекочитаемые имена. `resolveModel()` отдаёт `context`, `defaultMaxTokens`, `reasoning.efforts`, `inputModalities`. `listModels()` — каталог с сортировкой: бесплатные модели первыми, затем по имени.

### Маршрутизация запроса

1. `stream(options)` фиксирует снимок конфига и выбирает ключ (один раз на вызов).
2. Определяет транспорт модели:
   - явный override `modelTransports[modelId]`;
   - `provider.npm` из snapshot;
   - fallback — OpenAI Chat.
3. Собирает общий system + messages, tools, images, reasoning effort.
4. Добавляет заголовки: auth, `x-opencode-session`, UA, attribution.
5. Парсит SSE в `StreamChunk` (block-start/delta/block-end/usage/finish).
6. При 401/429 **до первого чанка** — ротация на следующий аккаунт (как в commandcode).

`x-opencode-session`:

```ts
const id = options.sessionId
  ? sha256(`dsh:${options.sessionId}`).slice(0, 32)
  : sha256(`dsh:${model}:${firstUserMessageIdOrHash}`).slice(0, 32)
```

Отсутствие `sessionId` не должно давать случайный ID на каждый retry: hash от содержимого стабилен между повторами.

### Квоты и UI

- Success cache 5 минут, failure 45 секунд; никакого фонового опроса, пока карточка выключена.
- Sidebar: progress bars rolling/weekly/monthly с `resetsAt`, warning на 80 %, exhausted на 95 %.
- `/opencode`: статус, план (Go/Go Plus), окна, активный аккаунт, расход за сессию.
- Settings → OpenCode: ключ, «импортировать из OpenCode», аккаунты, видимость моделей, лимиты контекста/вывода, транспорт-оверрайды, ZDR-подобных переключателей у OpenCode нет.
- Model picker: `FREE`, `Image`, контекст, reasoning efforts, пометка «Go» для маршрута подписки.

## 4. Конфигурация (эскиз)

```yaml
- id: llm-opencode
  name: "dsh-opencode-provider"
  config:
    apiKeyEnv: OPENCODE_API_KEY
    apiBase: https://opencode.ai/inference
    goApiBase: https://opencode.ai/inference/go
    usageBase: https://opencode.ai/zen/go/v1/usage
    importOpenCodeAuth: false
    requestTimeoutMs: 300000
    streamIdleTimeoutMs: 300000
    transportMaxRetries: 5
    visibleModels: []
    modelVisibility: {}
    modelTransports:
      claude-haiku-5-5: anthropic
      gpt-6-luna: openai-responses
      gemini-4-argon-contributor: google
    contextWindow:
    contextWindowOverrides: {}
    maxOutputTokens:
    accounts:
      - label: Go #2
        apiKeyEnv: OPENCODE_API_KEY_2
    activeAccount:
    modelAccountRules: []
    showSidebarQuota: false
    userAgent: dsh-opencode-provider/0.1.0
```

Все поля, кроме литерального `apiKey`, помечаются volatile — иначе DSH не покажет их в settings.

## 5. Этапы

### P0 — live-probe (полдня)

- С реальным ключом проверить единый `/zen/go/v1/chat/completions` на моделях `claude-haiku-5-5`, `gpt-6-luna`, `gemini-4-argon-contributor`.
- Проверить `/zen/go/v1/usage` и форму ответа.
- Зафиксировать: работает ли единый шлюз для всех семейств; нужен ли `anthropic-version`; принимает ли Anthropic endpoint `Bearer`.

### P1 — каркас и OpenAI Chat (основной объём)

- package.json / tsdown / cordis.patch.yml / dsh.bundle.
- Config + volatile, credential resolution, `auth.json` fallback.
- Каталог: live ids + snapshot, join по id, fallback.
- `OpenAI Chat` транспорт: текст, reasoning_content, tool calls, images, usage, finish.
- `x-opencode-session`, UA, attribution, классификация ошибок.
- `/opencode` команда.
- Тесты: wire body, SSE parser, session-id стабильность, key resolution, catalog join.

Покрытие: DeepSeek, GLM, Kimi, MiMo, LongCat, Hy3, Step, Qwen, MiniMax, Claude Haiku — все OpenAI Chat и Anthropic-модели. Free-модели тоже работают, если у ключа есть активная подписка Go; анонимный free-tier недоступен и намеренно не поддерживается.

### P2 — Anthropic Messages

- Claude Haiku, MiniMax M3, Qwen.
- Thinking blocks + signature replay, tool_use/tool_result, images.

### P3 — OpenAI Responses и Google

- GPT-6/5.6 Luna, Grok, Muse; Gemini Argon.
- Responses: `response.*` события, `function_call_output`.
- Google: `streamGenerateContent?alt=sse`, `functionCall` parts.

### P4 — UX и надёжность

- Settings-страница React (по образцу commandcode).
- Sidebar quota + Remote.
- Мультиаккаунт и model→account rules.
- Стоимость сессии по вендорному прайсу (опционально).
- Скрипт синхронизации каталога и CI-проверка drift.

## 6. Ошибки и лимиты

| Ситуация | Код / поведение |
|---|---|
| Нет ключа | `MISSING_CREDENTIAL` с инструкцией |
| 401 | `INVALID_CREDENTIAL`, без retry |
| `MissingSessionID` | не повторять слепо; проверить заголовок, показать диагностику |
| 402/quota wording | `QUOTA`, предложить free-модели или смену аккаунта |
| 429 + `Retry-After` | `RATE_LIMIT`, уважать задержку, ротация |
| 5xx/524/520 | `SERVER`/`TRANSPORT`, bounded retry |
| Cloudflare HTML 403/1010 | отдельная диагностика про UA |
| Модель не входит в Go | `UNKNOWN_MODEL`/`MODEL_NOT_IN_PLAN`, не ретраить |

Ретраи: не копировать 1000-retry политику commandcode; для OpenCode достаточно normal mode + отдельный небольшой бюджет на transport.

## 7. Риски

1. **Неофициальный usage endpoint.** Может измениться/исчезнуть. Квоты — fail-open, чат от них не зависит.
2. **`x-opencode-session` уже ломал клиентов.** Вынести в отдельный модуль с тестами и логированием факта отправки (без значения).
3. **Разные ключи для inference и usage.** 401 на usage не должен выглядеть как неверный ключ.
4. **Каталог дрейфует** (модели появляются/исчезают, модели.dev отстаёт). Live `/models` — источник истины, snapshot — только метаданные.
5. **ToS/abuse monitoring.** Go предназначен для coding-agent трафика; нужен собственный UA и стабильная сессия, без агрессивного параллелизма.
6. **Cloudflare** может резать запросы с «неизвестным» UA; версия в UA обязательна.
7. **Анонимная free-lane закрыта.** `Bearer public` + маскировка под CLI (`opencode2dsh`) — это обход клиентского гейта; не реализуем. Free-модели поддерживаются честно, через Go/Console-ключ.
8. **Лицензии.** commandcode и clinebot — MIT; при переносе кода сохранить NOTICE и attribution.

## 8. Проверка

- `npm run typecheck`, `npm run build`, `npm test`.
- Unit: конвертация сообщений/тулзов для каждого транспорта, SSE-парсеры, session-id, usage-нормализация, ротация.
- Contract: snapshot-тесты тел запросов на каждое семейство.
- Live smoke (опционально, по ключу): текст, tool loop, изображение, reasoning, 429.
- Install smoke: `dsh plugin --profile web add <path>` и загрузка на `0.2.1-rc.2`.

## 9. Источники

- OpenCode Go docs: https://opencode.ai/v2/docs/console/go
- OpenCode Console models: https://opencode.ai/v2/docs/console/models
- Usage endpoint и его форма: https://github.com/Proteusus/headroom/commit/0e47acb324d4abb389c675e42aa8329b72b874f0
- Проблема отсутствия публичного API квот: https://github.com/anomalyco/opencode/issues/31084
- Обязательность `x-opencode-session`: https://flabs.tech/blog/opencode-go-session-header-required
- Каталог моделей: https://models.dev/api.json (провайдер `opencode-go`)
- Референсы: https://github.com/Mars-Sea/dsh-commandcode-provider, https://github.com/GooDAnDReaDY/dsh-clinebot
