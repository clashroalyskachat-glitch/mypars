/**
 * nkse-schedule-cron — внешний «будильник» для GitHub Actions.
 *
 * Зачем: GitHub сильно задерживает собственные scheduled-workflow (у этого
 * аккаунта — на часы, иногда на полдня), поэтому расписание обновлялось
 * пачками вечером. Cloudflare Workers Cron Trigger срабатывает вовремя и
 * дёргает workflow_dispatch — GitHub запускает парсер сразу.
 *
 * Секрет GITHUB_TOKEN (fine-grained PAT, Actions: read and write) задаётся
 * командой:
 *   npx wrangler secret put GITHUB_TOKEN --config toolchain_foundry/cron-worker/wrangler.toml
 */
export default {
    async scheduled(controller, env, ctx) {
        const url =
            'https://api.github.com/repos/' +
            env.REPO +
            '/actions/workflows/' +
            env.WORKFLOW +
            '/dispatches';

        const res = await fetch(url, {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + env.GITHUB_TOKEN,
                Accept: 'application/vnd.github+json',
                'X-GitHub-Api-Version': '2022-11-28',
                'User-Agent': 'nkse-schedule-cron',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ ref: env.REF || 'main' }),
        });

        if (res.status !== 204) {
            const body = await res.text();
            console.error('dispatch failed', res.status, body.slice(0, 300));
            throw new Error('dispatch failed: ' + res.status);
        }
        console.log('dispatch ok', new Date().toISOString());
    },

    async fetch() {
        return new Response('nkse-schedule-cron: alive\n', {
            headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        });
    },
};
