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
    top: calc(var(--header-h, 64px) + 8px);
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

function inject(file) {
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

const targets = [
    path.join(OUT, 'mypars', 'index.html'),
    path.join(OUT, 'index.html'),
];
let injected = 0;
for (const file of targets) if (inject(file)) injected++;

console.log('app-frontend готов:', OUT, '| layout:', hasFull ? 'full' : 'schedule-only', '| badge:', injected);
