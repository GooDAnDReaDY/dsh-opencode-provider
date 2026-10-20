# 📦 @goodandready/dsh-opencode-provider

<div align="center">

<h3>Плагин-провайдер OpenCode Console и OpenCode Go для DeepSeek Harness</h3>

<p>
  <a href="https://goodandready.app/"><img src="https://img.shields.io/badge/🌐_DSH_Hub-goodandready.app-ff4500.svg?style=for-the-badge&labelColor=1a1a2e" alt="Витрина GoodAndReady"></a>
  <a href="https://www.npmjs.com/package/@goodandready/dsh-opencode-provider"><img src="https://img.shields.io/npm/v/@goodandready/dsh-opencode-provider?style=for-the-badge&color=crimson&logo=npm" alt="npm версия"></a>
  <a href="https://github.com/GooDAnDReaDY/dsh-opencode-provider/blob/main/LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg?style=for-the-badge" alt="Лицензия"></a>
</p>

</div>

<table align="center">
  <tr>
    <td align="center">
      ⭐ <strong>Если вам нравится этот плагин, поставьте ему Star на GitHub</strong> — это покажет мне, что плагин полезен, и добавит мотивации продолжать его развитие.
      <br><br>
      🐛 <strong>Если вы нашли баг или хотите предложить новую функцию</strong>, создайте Issue на GitHub на любом языке — я рассмотрю предложение и реализую полезные улучшения в одной из следующих версий плагина.
    </td>
  </tr>
</table>

---

Плагин-провайдер OpenCode / OpenCode Go для [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) (dsh).

Плагин регистрирует два нативных LLM-маршрута:

| Маршрут | Продукт / Тариф | Базовый эндпоинт | Назначение |
|---|---|---|---|
| `opencode` | OpenCode Console / Zen | `https://opencode.ai/inference` | Поминутная тарификация (pay-as-you-go) |
| `opencode-go` | OpenCode Go / Go Plus | `https://opencode.ai/inference/go` | Фиксированная подписка с лимитами 5h / недели / месяца |

Ключи разрешаются динамически на каждый вызов: смена токена в настройках или в файле окружения вступает в силу мгновенно без перезапуска сервера.

## Архитектура

```mermaid
graph LR
    subgraph DSH["Ядро DeepSeek Harness"]
        Agent["DSH Агент / Чат"]
        Creds["Сервис учетных записей / auth.json"]
    end

    subgraph Plugin["dsh-opencode-provider"]
        Router{"Выбор маршрута"}
        Pool["Пул аккаунтов<br/>(Авто-ротация и Cooldown)"]
        Heatmap["Телеметрия и Heatmap<br/>(5h / Неделя / Месяц)"]
        
        subgraph Transports["4 Протокола передачи (Wire Transports)"]
            T1["OpenAI Chat"]
            T2["Anthropic Messages<br/>(Thinking Signatures)"]
            T3["OpenAI Responses"]
            T4["Google GenAI<br/>(thoughtSignature Replay)"]
        end
    end

    subgraph OpenCode["Шлюз OpenCode Gateway"]
        Console["opencode (Console / Zen)"]
        Go["opencode-go (Go / Go Plus)"]
    end

    Agent --> Router
    Creds -.-> Pool
    Router -->|opencode| Pool
    Router -->|opencode-go| Pool
    Pool --> Heatmap
    Pool --> Transports
    T1 & T2 & T3 & T4 --> Console & Go
```

## Полный обзор возможностей

- **Четыре нативных транспорта**, выбираемых автоматически под каждую модель:
  - OpenAI Chat Completions (DeepSeek, GLM, Kimi, MiMo, LongCat, Hy3, Step и др.).
  - Anthropic Messages (Claude, MiniMax, Qwen).
  - OpenAI Responses (GPT, Grok, Muse).
  - Google Generative AI (Gemini).
- **Полноценная поддержка всех типов данных**: текст, рассуждения (reasoning), стриминг вызовов инструментов (tool calls), статистика токенов (usage), корректные finish reasons.
- **Обработка изображений** через встроенный сервис attachments с нативным рендерингом под протокол конкретного транспорта.
- **Воспроизведение метаданных провайдеров** при строгих требованиях API:
  - Подписи рассуждений Anthropic (`thinking signatures`).
  - Google `thoughtSignature` в истории вызовов функций.
- **Пул аккаунтов с интеллектуальной авто-ротацией** до старта генерации:
  - Автоматический переход на следующий аккаунт при 401/403/429 или ответах о превышении квот (400/402/403/429).
  - Недействительный ключ охлаждается 24 часа, превышение квоты — 10 минут (или по заголовку `Retry-After`), rate limit — 60 секунд (или по `Retry-After`).
  - Если запрос уже начал стриминг, он не переключается посреди ответа; следующий запрос берёт следующий готовый ключ.
- **Квоты по каждому аккаунту**: отображение индивидуального расхода за 5 часов, неделю и месяц; активный аккаунт управляет сайдбаром и панелью.
- **Правила «модель ➔ аккаунт»**: сопоставление по glob-паттернам закрепляет предпочтительный аккаунт за моделью; остальные аккаунты остаются в резерве.
- **Почасовой Heatmap запросов**: сетка «день недели × час» в локальном времени плюс суточная полоса агрегации. Фильтр переключает отображение между всеми запросами и конкретной моделью. Лог `~/.dsh/storages/dsh-opencode/requests.jsonl` хранит только метаданные `{at, provider, model, purpose}` (промпты и ответы не сохраняются).
- **Стабильный заголовок `x-opencode-session`**: вычисляется из устойчивого ID сессии DSH, обеспечивая одинаковый ключ маршрутизации при повторах и диалоге.
- **Живой каталог моделей**: автоматическое чтение `/v1/models` с резервным fallback из `models.dev`.
- **Оценки лимитов подписки OpenCode Go**: долларовый лимит и расчетное число запросов для окон 5h, недели и месяца для планов Go и Go Plus.
- **Команда `/opencode`**: быстрый просмотр статуса, квот, аккаунтов, моделей, правил и запуск теста связи `test [model]`.
- **Настройки в терминале (TUI)**: раздел `/settings → OpenCode` для профиля terminal с ключом, эндпоинтами, allowlist, активным аккаунтом и таймаутами.
- **Интеграция с Settings → Models**: карточка ключа в стандартном списке моделей DSH.
- **One-Click обновление плагина**: кнопка **Update now** в настройках проверяет npm registry, ставит точную версию через DSH CLI и запрашивает перезапуск.
- **Plan-aware Go picker**: фильтрация моделей вне тарифной сетки Go с бейджами `Go`, `Console` или `FREE`.
- **Защита лимита MCP-инструментов**: сохраняет системные инструменты DSH (`read`, `write`, `edit`, `bash`, `glob`, `grep`) при сокращении сторонних инструментов под лимит 128.
- **Панель аналитики использования**: карточки KPI (запросы, токены, успешность, reasoning, кэш, TTFT, задержка), фильтр 7/30/90 дней и таблицы Models / Days / Sessions.

## Установка

Сборка и упаковка из исходников:

```bash
npm install
npm run build
npm pack
```

Установка из **упакованного tarball**:

```bash
dsh plugin --profile web add /absolute/path/to/goodandready-dsh-opencode-provider-0.5.1.tgz
# DSH Desktop:
dsh plugin --profile desktop add /absolute/path/to/goodandready-dsh-opencode-provider-0.5.1.tgz

# Либо установка опубликованного пакета из npm:
dsh plugin --profile web add @goodandready/dsh-opencode-provider@0.5.1
```

После установки перезапустите dsh (или DSH Desktop) и выберите **OpenCode** или **OpenCode Go** в списке моделей.

## Конфигурация

Пример файла конфигурации:

```yaml
- id: llm-opencode
  name: "@goodandready/dsh-opencode-provider"
  config:
    apiKeyEnv: OPENCODE_API_KEY   # переменная окружения или имя credential
    # apiKey: oc_sk_...           # только для локальной сборки, не коммитить!
    openCodeAuthEntry: opencode-go
    requestTimeoutMs: 300000
    streamIdleTimeoutMs: 300000
    visibleModels: []
    modelTransports: {}
    accounts:
      - label: Go #2
        apiKeyEnv: OPENCODE_API_KEY_2
    activeAccount: ''            # метка аккаунта для принудительного закрепления
```

### Источники ключей

1. `config.apiKey` в конфигурации DSH (`role('secret')`).
2. Системные учетные данные DSH по имени `apiKeyEnv`.
3. Авто-импорт из `~/.local/share/opencode/auth.json` (по ключу `openCodeAuthEntry`, по умолчанию `opencode-go`), записанный CLI-утилитой OpenCode.
4. Переменные окружения процесса, проекта `.env` или `$DSH_HOME/.env`.

### Настройка пула аккаунтов и ротации

Добавьте второй аккаунт в **Настройки → OpenCode → Accounts**: укажите метку (например, `Go #2`) и имя переменной/credential (`OPENCODE_API_KEY_2`), вставьте ключ и сохраните. Аккаунт по умолчанию (`default`) всегда обслуживает запросы первым, если не закреплен другой.

При ошибке авторизации, исчерпании лимита или rate limit адаптер помечает ключ периодом охлаждения (cooldown) и немедленно повторяет запрос со следующим доступным аккаунтом. Состояния cooldown сохраняются между перезапусками в `~/.dsh/storages/dsh-opencode/cooldowns.json` по SHA-256 хешу ключа — сырые токены на диск не записываются.

### Правила привязки «модель ➔ аккаунт»

С помощью glob-паттернов можно закрепить определенные модели за выделенными аккаунтами:

```yaml
modelAccountRules:
  - pattern: "*free*"
    account: "free"
  - pattern: "your-provider-*"
    account: "go"
```

## Страница настроек Web UI

В разделе **Настройки → OpenCode**:
- **Key**: статус ключа, вставка, импорт из OpenCode CLI, очистка и кнопка **Test connection** с замером задержки.
- **Quota**: шкалы расхода за 5 часов, неделю и месяц с датами сброса и предупреждениями при 80% и 95%.
- **Accounts**: управление пулом дополнительных учетных записей.
- **Models**: поиск, обновление каталога, фильтрация allowlist, переопределение транспорта и просмотр стоимости токенов.
- **Connection**: таймауты, базовые URL и переключатель карточки сайдбара.
- **Plugin update**: статус версии и кнопка **Update now**.

## Команды CLI

```bash
/opencode status            # статус аккаунтов, квоты и правила
/opencode usage             # текущие окна квот
/opencode accounts          # список меток, статус и расход 5h/wk/mo
/opencode models            # список моделей и лимиты Go
/opencode rules             # правила модель ➔ аккаунт
/opencode test [model]      # проверочный запрос к модели
```

## Безопасность и надежность

- Запросы на изменение настроек и ключей разрешены только с loopback (`127.0.0.1` / `::1`) с обязательной проверкой same-origin для защиты от DNS-rebinding атак.
- Тексты запросов и ответов пользователей никогда не записываются в файлы журнала.
- При исчерпании квоты на одном ключе диалог пользователя не прерывается благодаря бесшовной ротации.

## Лицензия

MIT © [GooDAnDReaDY](https://github.com/GooDAnDReaDY). См. [LICENSE](./LICENSE) и [NOTICE](./NOTICE).

