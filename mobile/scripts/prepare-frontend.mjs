/**
 * Собирает app-frontend из полного layout сайта (меню + расписание + чаты +
 * библиотека) и добавляет офлайн-индикатор. Сайт не меняется: копия живёт
 * только внутри приложения.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SITE = path.resolve(ROOT, '..');
const FULL = path.join(SITE, 'firebase-dist');
const DIST = path.join(SITE, 'dist');
const OUT = path.join(ROOT, 'app-frontend');

const hasFull = fs.existsSync(path.join(FULL, 'mypars', 'index.html'));
const SRC = hasFull ? FULL : DIST;

if (!fs.existsSync(path.join(SRC, 'index.html'))) {
    throw new Error('Нет ни firebase-dist, ни dist — сначала собери сайт');
}

fs.rmSync(OUT, { recursive: true, force: true });
fs.cpSync(SRC, OUT, { recursive: true });

// Полный layout берём из firebase-dist, но само расписание — из свежего dist:
// так в приложении самые последние бандлы, темы и анимации, а не снимок
// прошлого деплоя.
if (hasFull) {
    fs.cpSync(DIST, path.join(OUT, 'mypars'), { recursive: true });
}

const BADGE = `
<style>
#nkse-offline {
    position: fixed;
    left: 8px;
    top: var(--nkse-badge-top, 72px);
    z-index: 9999;
    display: none;
    align-items: center;
    gap: 6px;
    padding: 5px 10px;
    border-radius: 999px;
    background: rgba(16, 16, 20, .94);
    color: #ffd166;
    font: 700 11px/1.2 system-ui, -apple-system, "Segoe UI", sans-serif;
    border: 1px solid rgba(255, 209, 102, .42);
    box-shadow: 0 8px 22px -10px #000;
    pointer-events: none;
}
#nkse-offline.is-on { display: inline-flex; }
#nkse-offline .dot {
    width: 7px; height: 7px; border-radius: 50%;
    background: #ff4d4d; box-shadow: 0 0 8px #ff4d4d;
}
#nkse-offline .when { color: #c9c4bc; font-weight: 600; }
</style>
<div id="nkse-offline" role="status">
    <span class="dot"></span><span>Офлайн</span><span class="when" id="nkse-offline-when"></span>
</div>
<script>
(function () {
    var box = document.getElementById('nkse-offline');
    var when = document.getElementById('nkse-offline-when');
    function fmt(ms) {
        if (!ms) return '';
        var d = new Date(ms);
        if (isNaN(d.getTime())) return '';
        return '· данные от ' +
            d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' }) + ' ' +
            d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    }
    function lastTime() {
        try {
            var v = parseInt(localStorage.getItem('nkse-file-mtime') || '0', 10);
            if (!v) v = parseInt(localStorage.getItem('nkse-checked-at') || '0', 10);
            return v || 0;
        } catch (e) { return 0; }
    }
    var forced = false;
    function render() {
        var off = forced || !navigator.onLine;
        box.classList.toggle('is-on', off);
        if (off) when.textContent = fmt(lastTime());
    }
    function probe() {
        if (!navigator.onLine) { forced = true; render(); return; }
        var ctrl = new AbortController();
        var timer = setTimeout(function () { ctrl.abort(); }, 4000);
        fetch('https://clashroalyskachat-glitch.github.io/mypars/schedule-meta.json?probe=' + Date.now(), {
            method: 'HEAD',
            cache: 'no-store',
            signal: ctrl.signal
        }).then(function (res) {
            clearTimeout(timer);
            forced = !res.ok;
            render();
        }).catch(function () {
            clearTimeout(timer);
            forced = true;
            render();
        });
    }
    window.addEventListener('online', function () { forced = false; render(); probe(); });
    window.addEventListener('offline', function () { forced = true; render(); });
    setInterval(probe, 20000);
    render();
    probe();
})();
</script>
`;

const MESSENGER_CARD = `
        <a class="card card-messenger" href="/mypars/messenger/">
            <span class="strap" aria-hidden="true"></span>

            <span class="card-top">
                <span class="badge" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M20.5 12.4c0 4.1-3.8 7.4-8.5 7.4-1 0-2-.2-2.9-.5L4 20.8l1.4-4.1A7 7 0 0 1 3.5 12.4C3.5 8.3 7.3 5 12 5s8.5 3.3 8.5 7.4z"/>
                        <path d="M8 11.8h8M8 14.8h5"/>
                    </svg>
                </span>
                <span class="num">02</span>
            </span>

            <span class="card-main">
                <span class="kicker">Общение</span>
                <span class="card-title">Мессенджер</span>
                <span class="card-note">Чаты группы, файлы и новости</span>
            </span>

            <span class="card-link">
                Открыть
                <span class="arrow" aria-hidden="true">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M5 12h13M12.5 5.5L19 12l-6.5 6.5"/>
                    </svg>
                </span>
            </span>

            <span class="art" aria-hidden="true">
                <span class="chat-bubbles"><i></i><i class="is-reply"></i><i></i></span>
            </span>
        </a>
`;

/**
 * Вырез камеры. Android-оболочка измеряет его и вызывает
 * window.__nkseApplyCutout(top, left, right, bottom) в dp. Значения живые:
 * при повороте, складывании и смене ориентации они приходят заново.
 */
const CUTOUT_HEAD = `
<style id="nkse-cutout-style">
:root {
    --nkse-cutout-top: env(safe-area-inset-top, 0px);
    --nkse-cutout-left: env(safe-area-inset-left, 0px);
    --nkse-cutout-right: env(safe-area-inset-right, 0px);
    --nkse-cutout-bottom: env(safe-area-inset-bottom, 0px);
    --nkse-cutout: var(--nkse-cutout-top);
}

/* Страница занимает весь экран: ни рамок, ни полос по краям.
   В тёмной теме сайт рисует body рамку 1px #fff — это и были белые линии. */
html[data-theme] body,
html[data-theme] body.app-body {
    border: 0 !important;
    outline: 0 !important;
}
html, body {
    border: 0 !important;
    outline: 0 !important;
    overscroll-behavior: none;
}
html {
    background-color: var(--t-bg, var(--bg, #08080a)) !important;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
html::-webkit-scrollbar,
body::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
}

/* Расписание: фон шапки уходит под камеру, текст остаётся ниже неё. */
body > header.sticky {
    padding-top: var(--nkse-cutout-top) !important;
    padding-left: var(--nkse-cutout-left) !important;
    padding-right: var(--nkse-cutout-right) !important;
}

/* Библиотека и пожелания: у их шапок свой фон. */
body > header.topbar {
    padding-top: var(--nkse-cutout-top) !important;
    padding-left: var(--nkse-cutout-left) !important;
    padding-right: var(--nkse-cutout-right) !important;
}

/* Меню: у шапки фона нет, поэтому отступает вся страница. Берём больший
   из двух отступов — родной отступ сайта или вырез камеры. */
body > main.wrap {
    padding-top: max(var(--nkse-cutout-top), var(--nkse-base-top, 0px)) !important;
    padding-left: var(--nkse-cutout-left) !important;
    padding-right: var(--nkse-cutout-right) !important;
}

/* Страницы без верхней шапки: отступает весь документ. */
body.nkse-pad-top {
    padding-top: var(--nkse-cutout-top) !important;
    padding-left: var(--nkse-cutout-left) !important;
    padding-right: var(--nkse-cutout-right) !important;
}

/* Мессенджер: карточка целиком ниже камеры, фон страницы закрывает вырез. */
body.nkse-messenger {
    padding-top: var(--nkse-cutout-top) !important;
    padding-left: var(--nkse-cutout-left) !important;
    padding-right: var(--nkse-cutout-right) !important;
}
body.nkse-messenger > #app.app {
    height: min(860px, calc(100dvh - 24px - var(--nkse-cutout-top))) !important;
}
body.nkse-messenger.is-fullscreen > #app.app,
body.nkse-messenger > #app.app.is-fullscreen {
    height: calc(100dvh - var(--nkse-cutout-top)) !important;
}
/* На телефоне мессенджер — плавающая карточка со скруглениями, а не
   квадрат во весь экран: снизу виден фон, углы не обрезаны. */
@media (max-width: 760px) {
    body.nkse-messenger > #app.app {
        width: calc(100% - 16px) !important;
        height: calc(100dvh - var(--nkse-cutout-top) - 20px) !important;
        border-radius: 24px !important;
        border: 1px solid var(--line) !important;
        box-shadow: 0 26px 70px -34px #000 !important;
    }
}
</style>
`;

const CUTOUT_SCRIPT = `
<script id="nkse-cutout-script">
(function () {
    var root = document.documentElement;
    var last = -1;

    function num(v) {
        v = Number(v);
        return (isFinite(v) && v > 0) ? v : 0;
    }

    function apply(top, left, right, bottom) {
        var t = num(top), l = num(left), r = num(right), b = num(bottom);
        root.style.setProperty('--nkse-cutout-top', t.toFixed(2) + 'px');
        root.style.setProperty('--nkse-cutout-left', l.toFixed(2) + 'px');
        root.style.setProperty('--nkse-cutout-right', r.toFixed(2) + 'px');
        root.style.setProperty('--nkse-cutout-bottom', b.toFixed(2) + 'px');
        root.style.setProperty('--nkse-cutout', t.toFixed(2) + 'px');
        var sum = t + l + r + b;
        root.classList.toggle('nkse-has-cutout', sum > 0.5);
        /* Шапки и вкладки пересчитывают свои отступы по resize. */
        if (Math.abs(sum - last) > 0.25) {
            last = sum;
            try { window.dispatchEvent(new Event('resize')); } catch (e) {}
            try { requestAnimationFrame(placeBadge); } catch (e) {}
        }
    }
    window.__nkseApplyCutout = apply;

    function fromBridge() {
        try {
            var api = window.NKSEInsets;
            if (api && typeof api.top === 'function') {
                var t = Number(api.top());
                var l = typeof api.left === 'function' ? Number(api.left()) : 0;
                var r = typeof api.right === 'function' ? Number(api.right()) : 0;
                var b = typeof api.bottom === 'function' ? Number(api.bottom()) : 0;
                apply(t, l, r, b);
                return (num(t) + num(l) + num(r) + num(b)) > 0.5;
            }
        } catch (e) {}
        return false;
    }

    /* Мост появляется чуть позже первого скрипта — ждём его до 4 секунд. */
    if (!fromBridge()) {
        var tries = 0;
        var timer = setInterval(function () {
            if (fromBridge() || ++tries > 40) clearInterval(timer);
        }, 100);
    }

    function layout() {
        var body = document.body;
        if (!body) return;
        var app = document.getElementById('app');
        var messenger = !!(app && app.parentNode === body);
        if (messenger) body.classList.add('nkse-messenger');

        /* Меню: запоминаем родной верхний отступ страницы. */
        var main = document.querySelector('body > main.wrap');
        if (main) {
            var base = parseFloat(getComputedStyle(main).paddingTop);
            if (isFinite(base)) main.style.setProperty('--nkse-base-top', base + 'px');
        }

        if (!messenger && !document.querySelector('body > header.sticky, body > header.topbar, main.wrap > header.top')) {
            body.classList.add('nkse-pad-top');
        }
        placeBadge();
    }

    /* Офлайн-плашка садится ровно под шапку, а не поверх неё. */
    function placeBadge() {
        if (!document.getElementById('nkse-offline')) return;
        var head = document.querySelector('body > header.sticky, body > header.topbar, main.wrap > header.top');
        var top = head ? head.getBoundingClientRect().bottom + 8 : 72;
        root.style.setProperty('--nkse-badge-top', Math.round(top) + 'px');
    }
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', layout);
    } else {
        layout();
    }
})();
</script>
`;

const MESSENGER_ISLAND = `
<style id="nkse-island-style">
#nkse-island {
    position: fixed;
    top: 0;
    left: 50%;
    transform: translateX(-50%);
    z-index: 9998;
    width: 172px;
    height: calc(var(--nkse-cutout-top, 36px) + 2px);
    min-height: 34px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 14px;
    border-radius: 999px;
    border: 1px solid rgba(255, 255, 255, .16);
    background: #000;
    color: #f6f0e4;
    font: 700 11px/1 -apple-system, "Segoe UI", system-ui, sans-serif;
    letter-spacing: .02em;
    box-shadow: 0 10px 28px -14px #000, inset 0 1px 0 rgba(255, 255, 255, .08);
    transition: width .28s cubic-bezier(.2, .8, .25, 1), border-color .28s ease;
}
html:not(.nkse-has-cutout) #nkse-island { display: none; }
#nkse-island .nkse-island-left,
#nkse-island .nkse-island-right { display: flex; align-items: center; }
#nkse-island .nkse-island-left { min-width: 0; }
#nkse-island .nkse-island-right { justify-content: flex-end; color: #c9c4bc; font-variant-numeric: tabular-nums; }
#nkse-island .nkse-island-dot {
    width: 7px; height: 7px; margin-right: 6px; border-radius: 50%;
    background: #35d07f; box-shadow: 0 0 10px #35d07f;
}
#nkse-island .nkse-island-phone { width: 14px; height: 14px; opacity: .8; }
#nkse-island #nkse-island-timer { display: none; }
#nkse-island.is-open { width: 200px; border-color: rgba(255, 214, 150, .4); }
#nkse-island.is-open #nkse-island-timer,
#nkse-island.is-call #nkse-island-timer { display: inline; }
#nkse-island.is-open .nkse-island-phone,
#nkse-island.is-call .nkse-island-phone { display: none; }
#nkse-island.is-call { border-color: rgba(255, 77, 94, .45); }
#nkse-island.is-call .nkse-island-dot {
    background: #ff4d5e; box-shadow: 0 0 10px #ff4d5e;
    animation: nkse-island-pulse 1.2s ease-in-out infinite;
}
@keyframes nkse-island-pulse { 50% { opacity: .35; } }
</style>
<div id="nkse-island" role="status" aria-label="Мессенджер НКСЭ">
    <span class="nkse-island-left"><i class="nkse-island-dot"></i><b id="nkse-island-title">PPS</b></span>
    <span class="nkse-island-right">
        <svg class="nkse-island-phone" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
            <path d="M6.7 3.5h2.1l1.4 3.3-1.6 1.2a12 12 0 0 0 5.4 5.4l1.2-1.6 3.3 1.4v2.1a2 2 0 0 1-2.2 2A15.5 15.5 0 0 1 4.7 5.7a2 2 0 0 1 2-2.2z"/>
        </svg>
        <span id="nkse-island-timer"></span>
    </span>
</div>
<script id="nkse-island-script">
(function () {
    var el = document.getElementById('nkse-island');
    if (!el) return;
    var title = document.getElementById('nkse-island-title');
    var timer = document.getElementById('nkse-island-timer');
    var callModal = document.getElementById('call-modal');
    var callStarted = 0;
    var interval = 0;
    var collapse = 0;

    function isCall() { return !!(callModal && !callModal.hidden); }
    function fmt(sec) {
        sec = Math.max(0, sec | 0);
        var m = Math.floor(sec / 60);
        var s = sec % 60;
        return (m < 10 ? '0' : '') + m + ':' + (s < 10 ? '0' : '') + s;
    }
    function paintCall() {
        if (!isCall()) {
            el.classList.remove('is-call');
            title.textContent = 'PPS';
            timer.textContent = '';
            if (interval) { clearInterval(interval); interval = 0; }
            callStarted = 0;
            return;
        }
        el.classList.add('is-call');
        title.textContent = 'Звонок';
        if (!callStarted) callStarted = Date.now();
        if (!interval) interval = setInterval(paintCall, 1000);
        timer.textContent = fmt(Math.floor((Date.now() - callStarted) / 1000));
    }
    function showClock() {
        el.classList.add('is-open');
        timer.textContent = new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
        clearTimeout(collapse);
        collapse = setTimeout(function () {
            if (isCall()) return;
            el.classList.remove('is-open');
            timer.textContent = '';
        }, 2600);
    }

    if (callModal && window.MutationObserver) {
        new MutationObserver(paintCall).observe(callModal, { attributes: true, attributeFilter: ['hidden'] });
    }
    el.addEventListener('click', function () {
        if (isCall()) {
            var card = callModal.querySelector('.call-card');
            if (card && card.scrollIntoView) card.scrollIntoView({ block: 'center' });
            return;
        }
        showClock();
    });
    paintCall();
})();
</script>
`;

function ensureViewportFit(html) {
    return html.replace(
        /<meta\s+name=["']viewport["']\s+content=["']([^"']*)["'][^>]*>/i,
        (tag, content) => (/viewport-fit/i.test(content)
            ? tag
            : tag.replace(content, content.replace(/\s*$/, '') + ', viewport-fit=cover'))
    );
}

function injectCutout(file) {
    let html = fs.readFileSync(file, 'utf8');
    if (html.includes('id="nkse-cutout-style"')) return false;
    html = ensureViewportFit(html);
    if (html.includes('</head>')) html = html.replace('</head>', CUTOUT_HEAD + '</head>');
    const isMessenger = /[\\/]mypars[\\/]messenger[\\/]index\.html$/i.test(file);
    html = html.replace(/<\/body>/i, CUTOUT_SCRIPT + (isMessenger ? MESSENGER_ISLAND : '') + '</body>');
    fs.writeFileSync(file, html, 'utf8');
    return true;
}

function injectBadge(file) {
    if (!fs.existsSync(file)) return false;
    let html = fs.readFileSync(file, 'utf8');
    if (html.includes('id="nkse-offline"')) return false;
    if (file === path.join(OUT, 'index.html') && !html.includes('card-messenger')) {
        html = html.replace(
            '<a class="card card-library"',
            MESSENGER_CARD + '        <a class="card card-library"'
        );
    }
    html = html.replace('</body>', BADGE + '</body>');
    fs.writeFileSync(file, html, 'utf8');
    return true;
}

function htmlFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) out.push(...htmlFiles(full));
        else if (entry.isFile() && entry.name.toLowerCase().endsWith('.html')) out.push(full);
    }
    return out;
}

const badgePages = [
    path.join(OUT, 'mypars', 'index.html'),
    path.join(OUT, 'index.html'),
];
let badges = 0;
for (const file of badgePages) if (injectBadge(file)) badges++;

let cutouts = 0;
for (const file of htmlFiles(OUT)) if (injectCutout(file)) cutouts++;

console.log(
    'app-frontend готов:', OUT,
    '| layout:', hasFull ? 'full' : 'schedule-only',
    '| badge:', badges,
    '| cutout:', cutouts
);
