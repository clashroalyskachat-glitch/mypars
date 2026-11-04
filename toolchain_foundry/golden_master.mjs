/*
 * Golden Master — детерминированный слепок отрендеренного расписания.
 *
 * Зачем: перед распилом app.js на модули нужен эталон поведения. Тест
 * поднимает dist, подменяет часы и данные, рендерит страницу в настоящем
 * браузере и сравнивает `#schedule-container` с сохранённым слепком.
 *
 * Детерминизм обеспечивают четыре вещи:
 *   1. часы заморожены на понедельник 10:00 по Москве (JS Date подменяется
 *      до загрузки скриптов, таймзона браузера принудительно Europe/Moscow);
 *   2. schedule.json подменяется фикстурой через CDP Fetch, а не берётся с диска;
 *   3. localStorage/cacheStorage чистится перед запуском;
 *   4. внешняя сеть не участвует: сервер локальный, шрифты локальные.
 *
 * Использование:
 *   node toolchain_foundry/golden_master.mjs --update   # перезаписать эталон
 *   node toolchain_foundry/golden_master.mjs            # проверить
 *
 * Требуется Chromium/Edge. Если браузера нет (или задан --skip), тест
 * печатает предупреждение и выходит с кодом 0 — CI без браузера не падает.
 */

import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const GOLDEN_DIR = path.join(ROOT, 'toolchain_foundry', 'golden');
const GOLDEN_HTML = path.join(GOLDEN_DIR, 'schedule-container.html');
const GOLDEN_HASH = path.join(GOLDEN_DIR, 'schedule-container.sha256');
const FIXTURE = path.join(ROOT, 'toolchain_foundry', 'fixtures', 'schedule.fixture.json');

const UPDATE = process.argv.includes('--update');
const SKIP = process.argv.includes('--skip');

/* Понедельник, 10:00 по Москве = 07:00 UTC. */
const FIXED_TIME = Date.UTC(2026, 10, 2, 7, 0, 0); // 2026-11-02T07:00:00Z

const MIME = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.woff2': 'font/woff2',
    '.webmanifest': 'application/manifest+json',
};

const BROWSERS = [
    process.env.CHROME_PATH,
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

const findBrowser = () => BROWSERS.find((p) => fs.existsSync(p));

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* ------------------------------------------------------------------ server */

function serve() {
    return new Promise((resolve) => {
        const server = http.createServer((req, res) => {
            let rel = decodeURIComponent(req.url.split('?')[0]);
            if (rel.endsWith('/')) rel += 'index.html';
            const file = path.join(DIST, rel);
            if (!file.startsWith(DIST)) {
                res.writeHead(403).end();
                return;
            }
            fs.readFile(file, (err, data) => {
                if (err) {
                    res.writeHead(404).end('not found');
                    return;
                }
                res.writeHead(200, {
                    'content-type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
                    'cache-control': 'no-store',
                });
                res.end(data);
            });
        });
        server.listen(0, '127.0.0.1', () => resolve({ server, port: server.address().port }));
    });
}

/* --------------------------------------------------------------------- cdp */

async function connect(port) {
    for (let i = 0; i < 60; i++) {
        try {
            const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
            const page = list.find((t) => t.type === 'page');
            if (page) return page.webSocketDebuggerUrl;
        } catch {}
        await sleep(250);
    }
    throw new Error('CDP did not start on port ' + port);
}

function makeClient(wsUrl) {
    const ws = new WebSocket(wsUrl);
    let seq = 0;
    const pending = new Map();
    const handlers = new Map();

    const ready = new Promise((res, rej) => {
        ws.addEventListener('open', res);
        ws.addEventListener('error', rej);
    });

    ws.addEventListener('message', (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            pending.get(msg.id)(msg);
            pending.delete(msg.id);
            return;
        }
        const hs = handlers.get(msg.method);
        if (hs) hs.forEach((h) => h(msg.params));
    });

    const send = (method, params) =>
        new Promise((resolve) => {
            const id = ++seq;
            pending.set(id, resolve);
            ws.send(JSON.stringify({ id, method, params: params || {} }));
        });

    const on = (method, fn) => {
        if (!handlers.has(method)) handlers.set(method, []);
        handlers.get(method).push(fn);
    };

    return { ready, send, on, close: () => ws.close() };
}

/* ------------------------------------------------------------- freeze hooks */

const FREEZE_SCRIPT = `
(() => {
    const FIXED = ${FIXED_TIME};
    const RealDate = Date;
    function FakeDate(...args) {
        if (!(this instanceof FakeDate)) return new RealDate(FIXED).toString();
        return args.length ? new RealDate(...args) : new RealDate(FIXED);
    }
    FakeDate.prototype = RealDate.prototype;
    FakeDate.now = () => FIXED;
    FakeDate.parse = RealDate.parse;
    FakeDate.UTC = RealDate.UTC;
    Object.setPrototypeOf(FakeDate, RealDate);
    window.Date = FakeDate;
    // requestAnimationFrame в тесте не нужен: анимации не влияют на DOM-слепок,
    // но без него часть кода падает в jsdom-подобных окружениях.
    if (!window.requestAnimationFrame) window.requestAnimationFrame = (cb) => setTimeout(() => cb(FIXED), 0);
})();
`;

/* ------------------------------------------------------------------- main */

async function run() {
    const browserPath = findBrowser();
    if (!browserPath || SKIP) {
        console.log('golden master skipped: no browser found (set CHROME_PATH to enable)');
        return 0;
    }

    const fixture = fs.readFileSync(FIXTURE);
    const { server, port } = await serve();
    const debugPort = 9500 + Math.floor(Math.random() * 400);
    const profile = path.join(os.tmpdir(), 'nkse-golden-' + process.pid);

    const child = spawn(
        browserPath,
        [
            '--headless=new',
            `--remote-debugging-port=${debugPort}`,
            `--user-data-dir=${profile}`,
            '--no-first-run',
            '--no-default-browser-check',
            '--disable-gpu',
            '--disable-extensions',
            'about:blank',
        ],
        { stdio: 'ignore' }
    );

    let exitCode = 0;
    try {
        const wsUrl = await connect(debugPort);
        const cdp = makeClient(wsUrl);
        await cdp.ready;

        await cdp.send('Page.enable');
        await cdp.send('Runtime.enable');
        await cdp.send('Network.enable');
        await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
        await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Moscow' });
        await cdp.send('Emulation.setDeviceMetricsOverride', {
            width: 1280,
            height: 900,
            deviceScaleFactor: 1,
            mobile: false,
        });
        await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: FREEZE_SCRIPT });

        // schedule.json всегда из фикстуры — реальные данные не влияют на эталон
        await cdp.send('Fetch.enable', { patterns: [{ urlPattern: '*schedule.json*' }] });
        cdp.on('Fetch.requestPaused', (params) => {
            if (params.request.url.includes('schedule.json')) {
                cdp.send('Fetch.fulfillRequest', {
                    requestId: params.requestId,
                    responseCode: 200,
                    responseHeaders: [{ name: 'Content-Type', value: 'application/json' }],
                    body: fixture.toString('base64'),
                });
            } else {
                cdp.send('Fetch.continueRequest', { requestId: params.requestId });
            }
        });

        await cdp.send('Page.navigate', { url: `http://127.0.0.1:${port}/` });

        // ждём именно отрисованные карточки, а не просто load
        let rendered = false;
        for (let i = 0; i < 100; i++) {
            const res = await cdp.send('Runtime.evaluate', {
                expression: "document.querySelectorAll('#schedule-container .lesson-card').length",
                returnByValue: true,
            });
            if ((res.result?.result?.value || 0) > 0) {
                rendered = true;
                break;
            }
            await sleep(100);
        }
        if (!rendered) throw new Error('schedule never rendered: no .lesson-card in #schedule-container');

        // ещё кадр, чтобы синхронные post-render эффекты успели примениться
        await sleep(400);

        const res = await cdp.send('Runtime.evaluate', {
            expression: "document.getElementById('schedule-container').innerHTML",
            returnByValue: true,
        });
        const raw = res.result?.result?.value || '';
        const normalized = raw
            .replace(/\s+/g, ' ')
            .replace(/>\s+</g, '><')
            .replace(/<!--[\s\S]*?-->/g, '')
            .trim();

        const hash = crypto.createHash('sha256').update(normalized).digest('hex');

        cdp.close();

        if (UPDATE) {
            fs.mkdirSync(GOLDEN_DIR, { recursive: true });
            fs.writeFileSync(GOLDEN_HTML, normalized + '\n', 'utf8');
            fs.writeFileSync(GOLDEN_HASH, hash + '\n', 'utf8');
            console.log('golden master updated');
            console.log('  length: ' + normalized.length + ' chars');
            console.log('  sha256: ' + hash);
            return 0;
        }

        if (!fs.existsSync(GOLDEN_HASH)) {
            console.log('no golden master yet — run with --update to create it');
            return 0;
        }

        const expected = fs.readFileSync(GOLDEN_HASH, 'utf8').trim();
        if (expected === hash) {
            console.log('golden master: match (' + hash.slice(0, 12) + ')');
            return 0;
        }

        const before = fs.readFileSync(GOLDEN_HTML, 'utf8').trim();
        console.error('golden master: MISMATCH');
        console.error('  expected ' + expected);
        console.error('  actual   ' + hash);
        let i = 0;
        while (i < before.length && i < normalized.length && before[i] === normalized[i]) i++;
        console.error('  first difference at char ' + i);
        console.error('  expected: …' + before.slice(Math.max(0, i - 60), i + 120).replace(/\n/g, '') + '…');
        console.error('  actual:   …' + normalized.slice(Math.max(0, i - 60), i + 120).replace(/\n/g, '') + '…');
        exitCode = 1;
    } catch (err) {
        console.error('golden master error: ' + err.message);
        exitCode = 1;
    } finally {
        child.kill();
        server.close();
        // профиль ещё держит процесс браузера: ждём и не падаем, если не отдал
        await sleep(800);
        try {
            fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {}
        try {
            fs.rmSync(path.join(ROOT, '.golden-profile'), { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
        } catch {}
    }
    return exitCode;
}

run().then((code) => process.exit(code));
