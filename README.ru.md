# @goodandready/dsh-opencode-provider

Плагин-провайдер OpenCode / OpenCode Go для [DeepSeek Harness](https://deepseek-harness.github.io/deepseek-harness/) (dsh).

Плагин регистрирует два нативных LLM-маршрута:

| Маршрут | Продукт | База |
|---|---|---|
| `opencode` | OpenCode Console / Zen (pay-as-you-go) | `https://opencode.ai/inference` |
| `opencode-go` | OpenCode Go / Go Plus | `https://opencode.ai/inference/go` |

Ключ разрешается на каждый запрос, поэтому смена credential применяется без перезапуска.

## Возможности

- Четыре транспорта: OpenAI Chat, OpenAI Responses, Anthropic, Google; выбор по модели.
- Живой каталог `/v1/models` с резервным generated-каталогом models.dev.
- Оценки лимитов Go и Go Plus для 5 часов / недели / месяца.
- Plan-aware picker (Go / Console / FREE).
- Пул аккаунтов: ротация на 401/403/429 и исчерпанной квоте; cooldown хранится по fingerprint ключа.
- Health аккаунтов, квоты по каждому аккаунту, правила «модель → аккаунт».
- Аналитика использования, heatmap запросов, таблицы Models / Days / Sessions.
- Core-инструменты сохраняются при лимите 128; изображения в tool-result заменяются placeholder.
- One-click обновление плагина в Settings → OpenCode.

## Установка

```bash
dsh plugin --profile web add @goodandready/dsh-opencode-provider@0.5.0
# DSH Desktop:
dsh plugin --profile desktop add @goodandready/dsh-opencode-provider@0.5.0
```

Либо из упакованного файла:

```bash
dsh plugin --profile web add /absolute/path/to/goodandready-dsh-opencode-provider-0.5.0.tgz
```

После установки перезапустите dsh / DSH Desktop и выберите **OpenCode** или **OpenCode Go** в picker.

## Настройка

Ключ берётся из DSH credentials, `OPENCODE_API_KEY` или `~/.local/share/opencode/auth.json`. В Settings → OpenCode можно вставить, импортировать или очистить ключ и выполнить **Test connection**.

Аккаунт `default` используется первым; дополнительные аккаунты служат fallback. `modelAccountRules` использует регистронезависимые `*` / `?` glob: первое совпадение задаёт предпочтительный аккаунт, остальные остаются fallback.

Go-маршрут показывает оценки лимитов на 5 часов, неделю и месяц, включая месячный долларовый allowance. Шлюз остаётся источником истины; значения в плагине — оценки.

## Квоты и аналитика

Карточка квоты в sidebar по умолчанию выключена; включите её в Settings → OpenCode. По клику открывается панель с аккаунтами, остатками 5h/неделя/месяц, временем сброса, аналитикой и heatmap запросов.

Heatmap агрегирует реальные вызовы адаптера по локальному времени, исключает `session-title` и `compaction`, а точные дубликаты схлопывает. Данные пишутся только в `~/.dsh/storages/dsh-opencode/requests.jsonl`; промптов, ответов и ключей там нет. Стоимость показывает только встроенный DSH; второй composer-пилюли плагин не добавляет.

## Обновление плагина

Карточка **Plugin update** в Settings → OpenCode:

1. `GET /dsh-opencode/update` сравнивает установленную версию с npm registry.
2. При наличии новой версии показывает badge и **Update now**.
3. Кнопка ставит точную версию через обычный `dsh plugin add`; параллельная установка блокируется, `--force` не используется, установка из worktree или `file:` запрещена.
4. После успеха карточка просит перезапустить DSH.

Если runtime не предоставляет DSH CLI, карточка сообщает, что автообновление недоступно, и направляет в plugin manager; проверка версии продолжает работать.

## Безопасность

- Write-маршруты требуют JSON, same-origin и literal loopback Host (`127.0.0.1` / `::1`) — это блокирует DNS rebinding.
- POST обновления дополнительно требует loopback, same-origin и `x-dsh-plugin-update: 1`.
- Ключ не возвращается из `/state` и не пишется в логи.
- Тело записи ограничено 256 KiB; request log хранит только `{at, provider, model, purpose}`.

## Совместимость

Проверено на DSH **0.2.1-rc.2**. UI требует web profile (Host нужен `ctx.webServer`); в TUI остаются команда `/opencode` и модельные маршруты.

## Ограничения

- Файловые вложения пока не передаются; изображения поддерживаются.
- Официальный usage endpoint неофициальный и может измениться; чат от него не зависит.
- Автообновление требует DSH CLI в runtime; иначе используйте DSH plugin manager.
- Анонимный free lane (`Bearer public` + CLI impersonation) не реализован.

## License

MIT. См. `LICENSE` и `NOTICE`.
