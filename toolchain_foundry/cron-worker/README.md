# nkse-schedule-cron

Внешний «будильник» для GitHub Actions.

GitHub сильно задерживает собственные `schedule`-запуски (у этого аккаунта —
на часы, иногда на полдня), поэтому расписание обновлялось пачками вечером.
Cloudflare Workers Cron Trigger срабатывает точно и дёргает
`workflow_dispatch` у workflow `update_and_deploy.yml` в репозитории
`clashroalyskachat-glitch/mypars`.

- Расписание: `*/10 * * * *` (UTC, каждые 10 минут).
- Публичный маршрут не нужен, но `fetch` отвечает `alive` для проверки.
- Бесплатный план Cloudflare: 144 запуска в сутки — далеко до лимитов.

## Первичная настройка

1. Создать fine-grained PAT: GitHub → Settings → Developer settings →
   Fine-grained tokens → Generate new token.
   - Repository access: **Only select repositories** → `mypars`
   - Permissions → Repository permissions → **Actions: Read and write**
   - Expiration: по желанию.
2. Положить токен в секрет Worker:

   ```bash
   npx wrangler secret put GITHUB_TOKEN --config toolchain_foundry/cron-worker/wrangler.toml
   ```

3. Задеплоить:

   ```bash
   npx wrangler deploy --config toolchain_foundry/cron-worker/wrangler.toml
   ```

## Как проверить

В GitHub → Actions у workflow «Auto-Update Schedule & Deploy» должны идти
запуски с событием `workflow_dispatch` примерно каждые 10 минут.
Свежесть проверки видна в `schedule-meta.json` (`checked_at`).

## Замена токена

Повторить шаг 2 с новым токеном (секрет перезапишется), деплой не нужен.
