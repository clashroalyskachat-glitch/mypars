// Логика приложения для расписания НКСЭ (все группы)

let allGroupsData = {};
/* Firebase-версия не хранит расписание: данные всегда берутся с GitHub Pages.
 * Локальный schedule.json остаётся только офлайн-фолбэком. */
const REMOTE_SCHEDULE = 'https://clashroalyskachat-glitch.github.io/mypars/schedule.json';
/* Маленький файл рядом: updated_at — когда таблица реально изменилась,
 * checked_at — когда парсер последний раз проверил сайт колледжа. */
const REMOTE_META = 'https://clashroalyskachat-glitch.github.io/mypars/schedule-meta.json';

/* Поведение из панели настроек. Ключи читает и settings.js. */
const PREF_NOW_BAR = 'nkse-pref-now-bar';
const PREF_NOW_ENDED = 'nkse-pref-now-ended';
const PREF_HIDE_PAST = 'nkse-pref-hide-past';
function readPrefBool(key, fallback) {
    try {
        const v = localStorage.getItem(key);
        return v === null ? fallback : v === '1';
    } catch (e) {
        return fallback;
    }
}
let showNowBar = readPrefBool(PREF_NOW_BAR, true);
/* «На сегодня пары закончились» по умолчанию не показываем: это статус,
 * а не полезная информация. Включается галочкой в настройках. */
let showNowEnded = readPrefBool(PREF_NOW_ENDED, false);
let hidePastLessons = readPrefBool(PREF_HIDE_PAST, false);
let currentGroup = localStorage.getItem('selected_group') || 'СЗ-13-26';
let currentDayFilter = 'all';
let lastModTime = null;
let _lastCheckAt = 0;

/* L1 hot slice: только расписание текущей группы (~2-3 КБ). Читается синхронно
 * до любого сетевого запроса, чтобы первый кадр был на экране за единицы мс.
 * Версия схемы в ключе: при смене формата старый срез просто игнорируется. */
const HOT_SLICE_KEY = 'nkse-hot-slice-v1';
const HOT_SLICE_SCHEMA = 1;

const PIN_KEY = 'nkse-pinned-groups';
const TEACHER_PIN_KEY = 'nkse-pinned-teachers';
const TEACHER_KEY = 'selected_teacher';
const VIEW_MODE_KEY = 'nkse-view-mode';

/* group view or teacher view */
let viewMode = localStorage.getItem(VIEW_MODE_KEY) === 'teacher' ? 'teacher' : 'group';
let currentTeacher = localStorage.getItem(TEACHER_KEY) || null;
/* true only when the teacher was opened by tapping their name on a group card */
let teacherFromGroup = false;
/* which tab is open inside the picker: groups or teachers */
let pickerMode = 'group';
let teacherList = [];
let teacherIndex = null;
let _teacherIndexSource = null;

/* ?group=СЗ-13-26 or ?teacher=Попкова — lets a classmate share a link */
(function applyViewFromUrl() {
    try {
        const params = new URLSearchParams(location.search);
        const t = params.get('teacher');
        const g = params.get('group');
        if (t) {
            currentTeacher = t;
            viewMode = 'teacher';
            localStorage.setItem(TEACHER_KEY, t);
            localStorage.setItem(VIEW_MODE_KEY, 'teacher');
        } else if (g) {
            currentGroup = g;
            viewMode = 'group';
            localStorage.setItem('selected_group', g);
            localStorage.setItem(VIEW_MODE_KEY, 'group');
        }
    } catch (e) {}
})();

function getPinned() {
    try {
        const v = JSON.parse(localStorage.getItem(PIN_KEY) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch (e) {
        return [];
    }
}

function setPinned(list) {
    localStorage.setItem(PIN_KEY, JSON.stringify(list));
    renderQuickGroups();
    renderPinButton();
}

function getPinnedTeachers() {
    try {
        const v = JSON.parse(localStorage.getItem(TEACHER_PIN_KEY) || '[]');
        return Array.isArray(v) ? v.filter((x) => typeof x === 'string') : [];
    } catch (e) {
        return [];
    }
}

function setPinnedTeachers(list) {
    localStorage.setItem(TEACHER_PIN_KEY, JSON.stringify(list));
    renderQuickGroups();
    renderPinButton();
}

function togglePin() {
    if (viewMode === 'teacher' && currentTeacher) {
        const pinned = getPinnedTeachers();
        const i = pinned.indexOf(currentTeacher);
        if (i === -1) {
            pinned.push(currentTeacher);
        } else {
            pinned.splice(i, 1);
        }
        setPinnedTeachers(pinned);
        uiSound('tap');
        return;
    }
    const pinned = getPinned();
    const i = pinned.indexOf(currentGroup);
    if (i === -1) {
        pinned.push(currentGroup);
    } else {
        pinned.splice(i, 1);
    }
    setPinned(pinned);
    uiSound('tap');
}

// "Обновление на сервере: 02.10.2026 в 20:44" -> "Обновлено 02.10 · 20:44".
// Accepts either ms or s; anything falsy means "we do not know yet".
function formatUpdatedLabel(modTime) {
    if (!modTime) return 'Обновляется каждые 10 минут';
    const ms = modTime < 1e11 ? modTime * 1000 : modTime;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return 'Обновляется каждые 10 минут';
    const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `Обновлено ${date} · ${time}`;
}

function formatClock(ms) {
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `${date} · ${time}`;
}

function isNarrowHeader() {
    return typeof window.matchMedia === 'function'
        && window.matchMedia('(max-width: 639px)').matches;
}

// На телефоне полная дата не влезает в шапку. Если проверка была сегодня —
// показываем только время, иначе оставляем дату, чтобы не соврать.
function shortClock(ms) {
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    const now = new Date();
    const sameDay =
        d.getFullYear() === now.getFullYear() &&
        d.getMonth() === now.getMonth() &&
        d.getDate() === now.getDate();
    if (!sameDay) return formatClock(ms);
    return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}

let _labelModTime = null;
let _labelCheckedAt = null;

// В шапке показываем «Проверено ЧЧ:ММ» — это время последней проверки сайта
// колледжа, оно двигается каждые 10 минут. Когда именно менялись сами данные —
// в подсказке (и это же время уходит в offline-кэш).
function setUpdatedLabel(modTime, checkedAt) {
    _labelModTime = modTime || null;
    _labelCheckedAt = checkedAt || null;
    const el = document.getElementById('last-updated');
    if (!el) return;
    if (checkedAt) {
        const clock = isNarrowHeader() ? shortClock(checkedAt) : formatClock(checkedAt);
        el.textContent = 'Проверено ' + clock;
        el.title = modTime ? 'Данные обновлены ' + formatClock(modTime) : '';
    } else {
        el.textContent = formatUpdatedLabel(modTime);
        el.removeAttribute('title');
    }
    // На телефоне подсказка недоступна (нет hover), поэтому время изменения
    // самой таблицы дублируем в подвале.
    const dataTime = document.getElementById('data-time');
    if (dataTime) {
        dataTime.textContent = modTime ? 'Данные обновлены ' + formatClock(modTime) : '';
    }
}

// Поворот телефона/ресайз окна: пересобрать подпись в нужном формате.
if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('resize', () => {
        if (_labelCheckedAt || _labelModTime) setUpdatedLabel(_labelModTime, _labelCheckedAt);
    });
}

function renderPinButton() {
    const btn = document.getElementById('pin-btn');
    if (!btn) return;
    const isTeacher = viewMode === 'teacher' && !!currentTeacher;
    const on = isTeacher ? getPinnedTeachers().includes(currentTeacher) : getPinned().includes(currentGroup);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-on', on);
    btn.title = isTeacher
        ? (on ? 'Открепить преподавателя' : 'Закрепить преподавателя')
        : (on ? 'Открепить группу' : 'Закрепить группу');
}

function renderQuickGroups() {
    const bar = document.getElementById('quick-groups');
    if (!bar) return;

    const pinnedGroups = getPinned();
    const pinnedTeachers = getPinnedTeachers();
    if (pinnedTeachers.length) ensureTeacherIndex();

    const groups = pinnedGroups.filter((g) => allGroupsData[g]);
    const teachers = pinnedTeachers.filter((t) => teacherIndex && teacherIndex[t]);
    // Only offer "back to group" when the user actually came from a group card.
    const showBack = viewMode === 'teacher' && teacherFromGroup && !!currentGroup;
    if (groups.length === 0 && teachers.length === 0 && !showBack) {
        bar.innerHTML = '';
        return;
    }

    const back = showBack
        ? `<button class="quick-btn quick-back" data-back-group="${escapeHtml(currentGroup)}" title="Вернуться к расписанию группы">← К группе ${escapeHtml(currentGroup)}</button>`
        : '';

    bar.innerHTML =
        back +
        groups
            .map(
                (g) =>
                    `<button class="quick-btn" data-group="${escapeHtml(g)}" aria-current="${viewMode === 'group' && g === currentGroup}">${escapeHtml(g)}</button>`
            )
            .join('') +
        teachers
            .map(
                (t) =>
                    `<button class="quick-btn" data-teacher="${escapeHtml(t)}" aria-current="${viewMode === 'teacher' && t === currentTeacher}">👨‍🏫 ${escapeHtml(t)}</button>`
            )
            .join('');

    bar.querySelectorAll('[data-group]').forEach((b) => {
        b.addEventListener('click', () => selectGroup(b.dataset.group));
    });
    bar.querySelectorAll('[data-back-group]').forEach((b) => {
        b.addEventListener('click', () => selectGroup(b.dataset.backGroup));
    });
    bar.querySelectorAll('[data-teacher]').forEach((b) => {
        b.addEventListener('click', () => selectTeacher(b.dataset.teacher));
    });
}

/* ---------------- "what's happening now" bar ---------------- */
const DAYS_SEARCH = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

const HTML_ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

function uiSound(name) {
    try {
        if (window.NKSETheme) window.NKSETheme.play(name);
    } catch (e) {}
}

// 1 пара, 2 пары, 5 пар; 21 замена, 22 замены, 11 замен.
function pluralRu(n, one, few, many) {
    const mod100 = Math.abs(n) % 100;
    const mod10 = mod100 % 10;
    if (mod100 > 10 && mod100 < 20) return many;
    if (mod10 === 1) return one;
    if (mod10 >= 2 && mod10 <= 4) return few;
    return many;
}

function lessonCountLabel(n) {
    return `${n} ${pluralRu(n, 'пара', 'пары', 'пар')}`;
}

function substitutionLabel(n) {
    return `${n} ${pluralRu(n, 'замена', 'замены', 'замен')}`;
}

// "08:10-9:30", "8:10 – 9:30", "08.10-09.30" -> minutes from midnight.
function parseStartMinutes(time) {
    const m = String(time || '').match(/(\d{1,2})\s*[:.]\s*(\d{2})/);
    if (!m) return 9999;
    return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
}

function runSearch(query) {
    const box = document.getElementById('search-results');
    if (!box) return;
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
        box.hidden = true;
        box.innerHTML = '';
        return;
    }

    // A merged lesson ("совмещёнка") is stored once per group, so a flat search
    // showed it N times and listed only the groups that happened to match the
    // query. Everything is therefore collected per physical lesson first
    // (day + real start time + subject + room), then filtered.
    const byLesson = new Map();

    for (const group of Object.keys(allGroupsData)) {
        const days = allGroupsData[group];
        for (const day of DAYS_SEARCH) {
            for (const l of days[day] || []) {
                const start = parseStartMinutes(l.time);
                const key = [day, start, (l.subject || '').trim().toLowerCase(), (l.room || '').trim()].join('|');

                let slot = byLesson.get(key);
                if (!slot) {
                    slot = { day, start, l, groups: [], teachers: [], matched: false };
                    byLesson.set(key, slot);
                }
                if (!slot.groups.includes(group)) slot.groups.push(group);

                // Comma/&-joined teacher lists belong to one physical lesson
                String(l.teacher || '').split(/[&,]/).forEach((t) => {
                    const name = normTeacherName(t);
                    if (name && !slot.teachers.includes(name)) slot.teachers.push(name);
                });
                (l.subgroups || []).forEach((s) => {
                    const name = normTeacherName(s && s.teacher);
                    if (name && !slot.teachers.includes(name)) slot.teachers.push(name);
                });

                const subs = (l.subgroups || []).map((s) => `${s.teacher || ''} ${s.room || ''}`).join(' ');
                const hay = `${l.subject || ''} ${l.teacher || ''} ${l.room || ''} ${subs} ${slot.teachers.join(' ')}`.toLowerCase();
                if (hay.includes(q)) slot.matched = true;
            }
        }
    }

    // Chronological: day, then actual start time, then subject. The official
    // pair numbers are not chronological (a merged lesson can be "№2" and start
    // after "№3"), which is exactly what used to look broken.
    const hits = [...byLesson.values()]
        .filter((s) => s.matched)
        .sort((a, b) =>
            DAYS_SEARCH.indexOf(a.day) - DAYS_SEARCH.indexOf(b.day) ||
            a.start - b.start ||
            String(a.l.subject || '').localeCompare(String(b.l.subject || ''))
        );

    // Teachers are split by comma in the data ("Парфенова Е В, Бессарабова А Д").
    // Kept in the same physical-lesson slot so a merged lesson still lists
    // every teacher once.
    ensureTeacherIndex();
    const teacherMatches = teacherList.filter((t) => t.toLowerCase().includes(q)).slice(0, 6);
    const teacherRow = teacherMatches.length
        ? `<div class="search-hit"><span class="muted">Преподаватели:</span>${teacherMatches
              .map((t) => `<button class="quick-btn" data-teacher="${escapeHtml(t)}">👨‍🏫 ${escapeHtml(t)}</button>`)
              .join('')}</div>`
        : '';

    if (hits.length === 0 && teacherMatches.length === 0) {
        box.hidden = false;
        box.innerHTML = `<div class="search-hit"><span class="muted">Ничего не найдено по запросу «${escapeHtml(query.trim())}»</span></div>`;
        return;
    }

    const shown = hits.slice(0, 120);
    box.hidden = false;
    box.innerHTML =
        teacherRow +
        (hits.length
            ? `<div class="search-hit"><span class="muted">Найдено уроков: ${hits.length}${hits.length > shown.length ? `, показаны первые ${shown.length}` : ''}</span></div>` +
              shown
                  .map((h) => {
                      const extra = h.teachers.length > 3 ? ` и ещё ${h.teachers.length - 3}` : '';
                      const teachers = h.teachers.slice(0, 3).join(' · ') + extra;
                      return `
        <div class="search-hit">
            <b>${escapeHtml(h.day)}</b>
            <span class="muted">${escapeHtml(h.l.time || '')}</span>
            <b>${escapeHtml(h.l.subject || '')}</b>
            ${h.l.room ? `<span class="muted">Каб: ${escapeHtml(h.l.room)}</span>` : ''}
            ${teachers ? `<span class="muted">${escapeHtml(teachers)}</span>` : ''}
            ${h.groups.length > 1 ? `<span class="muted">совмещёнка · ${h.groups.length} групп</span>` : ''}
            ${h.groups.map((g) => `<button class="quick-btn" data-group="${escapeHtml(g)}" data-day="${escapeHtml(h.day)}">${escapeHtml(g)}</button>`).join('')}
        </div>`;
                  })
                  .join('')
            : '');
}

// Keep a copy of schedule.json inside Cache Storage even when the page was
// painted from localStorage. Without this the service worker has no data to
// fall back on, and the first offline load after the localStorage copy went
// stale shows the "ошибка загрузки" screen.
//
// `rawText` is the payload loadSchedule already downloaded and parsed: reusing
// it removes a second full download of the same file on every cold start.
function warmOfflineCache(rawText) {
    if (!('caches' in window)) return;
    const url = 'schedule.json';
    caches.open(OFFLINE_DATA_CACHE).then((cache) =>
        cache.match(url).then((hit) => {
            if (hit) return null;
            if (typeof rawText === 'string' && rawText.length) {
                return cache.put(
                    url,
                    new Response(rawText, { headers: { 'Content-Type': 'application/json' } })
                );
            }
            return fetch(url, { cache: 'reload' }).then((res) => {
                if (res && res.ok) return cache.put(url, res.clone());
                return null;
            });
        })
    ).catch(() => {});
}

// Any cached copy is better than an error screen: used when the network is
// unreachable and the localStorage copy is older than CACHE_DURATION.
function renderFromStaleCache(reason) {
    try {
        const cached = localStorage.getItem('nkse-schedule-cache');
        if (!cached) return false;
        allGroupsData = JSON.parse(cached);
        if (!allGroupsData || Object.keys(allGroupsData).length === 0) return false;

        const mtime = localStorage.getItem('nkse-file-mtime');
        populateGroupSelect();
        renderQuickGroups();
        renderPinButton();
        renderDataHealth();
        checkAndAutoSwitchDay();
        renderTabs();
        renderSchedule();

        const el = document.getElementById('last-updated');
        if (el) {
            el.textContent = mtime ? `${formatUpdatedLabel(parseInt(mtime))} · офлайн` : 'Офлайн · сохранённая копия';
        }
        const health = document.getElementById('data-health');
        if (health) health.textContent += ' · нет сети, показана сохранённая копия';
        console.warn('Offline fallback used:', reason);
        return true;
    } catch (e) {
        return false;
    }
}

function renderDataHealth() {
    const el = document.getElementById('data-health');
    if (!el) return;
    const groups = Object.keys(allGroupsData).length;
    if (groups === 0) {
        el.textContent = '';
        return;
    }
    let lessons = 0;
    let emptyDays = 0;
    for (const g of Object.keys(allGroupsData)) {
        for (const day of Object.keys(allGroupsData[g])) {
            const n = (allGroupsData[g][day] || []).length;
            lessons += n;
            if (n === 0) emptyDays++;
        }
    }
    el.textContent = `${groups} групп · ${lessons} пар${emptyDays ? ` · дней без пар: ${emptyDays}` : ''}`;
}

function clearSearch() {
    const input = document.getElementById('search-input');
    const box = document.getElementById('search-results');
    const reset = document.getElementById('search-reset');
    if (input) input.value = '';
    if (box) {
        box.hidden = true;
        box.innerHTML = '';
    }
    if (reset) reset.hidden = true;
}

// Hidden easter egg: triple-click the DISCIPLINE word in the footer.
function initSecretLink() {
    const word = document.getElementById('discipline-word');
    if (!word) return;
    const url = 'https://drive.google.com/file/d/1OJAnA0VFLw5S6ToGuAXCOll7UgQ0yvtY/view?usp=sharing';
    let clicks = 0;
    let resetTimer = 0;
    word.addEventListener('click', (e) => {
        e.preventDefault();
        clicks += 1;
        clearTimeout(resetTimer);
        if (clicks >= 3) {
            clicks = 0;
            const win = window.open(url, '_blank', 'noopener,noreferrer');
            if (!win) window.location.href = url;
            return;
        }
        resetTimer = setTimeout(() => { clicks = 0; }, 700);
    });
}

function initSearch() {
    const input = document.getElementById('search-input');
    const reset = document.getElementById('search-reset');
    const box = document.getElementById('search-results');
    if (!input) return;

    // One scan touches 150 groups (~2700 lessons) and rebuilds up to 120 rows of
    // markup, so running it per keystroke makes typing feel sticky. Coalesce to
    // one run per frame-ish and never lag behind what is typed.
    let pending = null;
    const scheduleSearch = () => {
        if (pending) return;
        pending = setTimeout(() => {
            pending = null;
            runSearch(input.value);
        }, 90);
    };

    input.addEventListener('input', () => {
        reset.hidden = input.value.length === 0;
        scheduleSearch();
    });
    if (reset) {
        reset.addEventListener('click', () => {
            if (pending) {
                clearTimeout(pending);
                pending = null;
            }
            clearSearch();
            input.focus();
        });
    }

    // One delegated listener instead of a new click handler for every chip in
    // every result row (a broad query could attach ~150 of them per keystroke).
    if (box) {
        box.addEventListener('click', (e) => {
            const b = e.target.closest ? e.target.closest('[data-group], [data-teacher]') : null;
            if (!b) return;
            if (b.dataset.teacher) {
                clearSearch();
                selectTeacher(b.dataset.teacher);
                return;
            }
            if (!b.dataset.group) return;
            // jump straight to the matched day when the hit carries one
            if (b.dataset.day && DAYS_ORDER.indexOf(b.dataset.day) !== -1) {
                currentDayFilter = b.dataset.day;
            }
            clearSearch();
            selectGroup(b.dataset.group);
            renderTabs();
        });
    }
}

const DAYS_OF_WEEK = [
    { id: 'all', name: '📅 Вся неделя' },
    { id: 'Понедельник', name: 'Понедельник' },
    { id: 'Вторник', name: 'Вторник' },
    { id: 'Среда', name: 'Среда' },
    { id: 'Четверг', name: 'Четверг' },
    { id: 'Пятница', name: 'Пятница' },
    { id: 'Суббота', name: 'Суббота' }
];

const DAYS_ORDER = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

const JS_DAYS_MAP = {
    1: 'Понедельник',
    2: 'Вторник',
    3: 'Среда',
    4: 'Четверг',
    5: 'Пятница',
    6: 'Суббота',
    0: 'Воскресенье'
};

const CARD_ACCENTS = [
    'border-l-blue-600 dark:border-l-blue-500',
    'border-l-indigo-600 dark:border-l-indigo-500',
    'border-l-violet-600 dark:border-l-violet-500',
    'border-l-amber-600 dark:border-l-amber-500',
    'border-l-emerald-600 dark:border-l-emerald-500',
    'border-l-rose-600 dark:border-l-rose-500'
];

 function init() {
     const todayJsDay = new Date().getDay();
     const todayName = JS_DAYS_MAP[todayJsDay];
     currentDayFilter = (todayName && todayName !== 'Воскресенье') ? todayName : 'Понедельник';
     initUI();
     loadSchedule();
     sendVisitBeacon();
 }

/* ---------- статистика посещений ----------
   Один POST на вкладку: домен и анонимный id устройства. Сбой сети или
   отсутствие эндпоинта ничего не ломают — счётчик молча пропускается. */
const NKSE_STATS_API = 'https://script.google.com/macros/s/AKfycbyLgfwIeyM6irptQU_4I3giVfX2AO0wPCnkGtMRa_GrKBHGdUu9n23u0YEnOA7WtG1z/exec';

function sendVisitBeacon() {
    try {
        // локальные прогоны и предпросмотр не считаем
        if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) return;
        if (sessionStorage.getItem('nkse-visit')) return;
        sessionStorage.setItem('nkse-visit', '1');

        let vid = localStorage.getItem('nkse-vid');
        if (!vid) {
            vid = Math.random().toString(36).slice(2) + Date.now().toString(36);
            localStorage.setItem('nkse-vid', vid);
        }

        fetch(NKSE_STATS_API, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify({
                board: 'stats',
                op: 'hit',
                host: location.hostname,
                vid: vid,
                page: location.pathname,
            }),
            keepalive: true,
        }).catch(() => {});
    } catch (e) {
        /* приватный режим и т.п. — просто без статистики */
    }
}

 if (document.readyState === 'loading') {
     document.addEventListener('DOMContentLoaded', init);
 } else {
     init();
 }

function initOffline() {
    if (!('serviceWorker' in navigator)) return;
    // file:// and http on a LAN IP are not secure contexts; guard quietly.
    if (location.protocol === 'file:') return;
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js').then(
            (reg) => {
                window.__nkseSW = reg;
            },
            () => {
                /* offline support unavailable - app still works online */
            }
        );
    });
}

function clearOfflineCache() {
    if (!navigator.serviceWorker || !navigator.serviceWorker.controller) return;
    navigator.serviceWorker.controller.postMessage('CLEAR_CACHES');
    setTimeout(() => window.location.reload(), 300);
}

function initUI() {
    // drop the preference from the removed week-view mode
    try { localStorage.removeItem('nkse-view'); } catch (e) {}

    fetchScheduleVersion().then((data) => { lastModTime = data ? data.mod_time : 0; });

    const groupSelect = document.getElementById('group-select');
    if (groupSelect) {
        groupSelect.addEventListener('change', (e) => {
            selectGroup(e.target.value);
        });
    }
    initGroupPicker();
    initDayTabRipple();

    const pinBtn = document.getElementById('pin-btn');
    if (pinBtn) pinBtn.addEventListener('click', togglePin);

    initNowBar();

    initSearch();
    initSecretLink();
    initOffline();

    document.addEventListener('keydown', (e) => {
        const tag = document.activeElement && document.activeElement.tagName;
        const typing = /^(INPUT|SELECT|TEXTAREA)$/.test(tag);
        if (e.key === '/' && !typing) {
            e.preventDefault();
            const si = document.getElementById('search-input');
            if (si) si.focus();
            return;
        }
        if (e.key === 'Escape') {
            if (tag === 'INPUT') {
                clearSearch();
                document.activeElement.blur();
            }
            return;
        }
        if (typing || e.metaKey || e.ctrlKey || e.altKey) return;

        /* day navigation: arrows / Home / End */
        if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
            e.preventDefault();
            const i = DAYS_OF_WEEK.findIndex((d) => d.id === currentDayFilter);
            const next = e.key === 'ArrowLeft' ? (i - 1 + DAYS_OF_WEEK.length) % DAYS_OF_WEEK.length : (i + 1) % DAYS_OF_WEEK.length;
            window.filterDay(DAYS_OF_WEEK[next].id);
            return;
        }
        if (e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
            window.filterDay(e.key === 'Home' ? DAYS_OF_WEEK[0].id : DAYS_OF_WEEK[DAYS_OF_WEEK.length - 1].id);
            return;
        }
        /* theme toggle */
        if (e.key === 't' || e.key === 'T' || e.key === 'е' || e.key === 'Е') {
            e.preventDefault();
            toggleTheme();
        }
    });

    renderTabs();
    renderPinButton();
    updatePickerLabel();
    syncPickerModes();

    syncHeaderOffset();
    // ResizeObserver уже ловит изменение высоты шапки (в т.ч. при ресайзе
    // окна и загрузке шрифта) — отдельный resize-слушатель только зря читал
    // layout на каждое движение окна.
    if (typeof ResizeObserver === 'function') {
        new ResizeObserver(syncHeaderOffset).observe(document.querySelector('header'));
    }
}

/* Последняя отрисованная полоса дней: фоновые обновления расписания не должны
 * пересобирать те же 7 кнопок (и сбрасывать золотую капсулу). */
let _tabsHtml = '';

 function renderTabs() {
     const tabsContainer = document.getElementById('days-tabs');
     var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
     var activeBg = isDark ? '' : 'bg-blue-600';
     var activeText = isDark ? 'text-purple-400 border-purple-400' : 'text-white';
     var inactiveText = isDark ? 'text-gray-400' : 'text-slate-600';
     var todayName = JS_DAYS_MAP[new Date().getDay()];
     const html = DAYS_OF_WEEK.map(day => `
         <button onclick="filterDay('${day.id}')" 
             class="day-tab whitespace-nowrap transition-all duration-300 flex-shrink-0 font-bold ${currentDayFilter === day.id ? activeBg + ' ' + activeText + ' day-tab-active' : inactiveText}">
             ${day.id === todayName ? '<span class="tab-today-dot" title="Сегодня"></span>' : ''}${day.name}
         </button>
     `).join('');

     if (html === _tabsHtml) return;
     _tabsHtml = html;
     tabsContainer.innerHTML = html;

     // Скроллим сразу: отложенный smooth-скролл через 100 мс двигал полосу
     // уже во время полёта капсулы, и она «промахивалась» мимо вкладки.
     const activeTab = tabsContainer.querySelector(`button[onclick="filterDay('${currentDayFilter}')"]`);
     if (activeTab) {
         const instant = tabsContainer.classList.contains('dock-moving');
         activeTab.scrollIntoView({ behavior: instant ? 'auto' : 'smooth', inline: 'center', block: 'nearest' });
     }
 }

window.filterDay = function(dayId) {
    const changed = currentDayFilter !== dayId;
    currentDayFilter = dayId;
    renderTabs();
    renderSchedule();
    // Switching days while deep in the week used to keep the old scroll
    // offset, dropping the user into the middle of the new day. Bring the
    // first card back under the sticky tabs instead.
    if (changed) scrollToScheduleTop();
    if (changed) uiSound('switch');
}

function scrollToScheduleTop() {
    const container = document.getElementById('schedule-container');
    if (!container) return;
    const header = document.querySelector('header');
    const wrap = document.querySelector('.days-tabs-sticky');
    const tabs = document.getElementById('days-tabs');
    const headerH = header ? header.offsetHeight : 0;
    const stickyH = wrap ? wrap.offsetHeight : (tabs ? tabs.offsetHeight : 0);
    const target = container.getBoundingClientRect().top + window.scrollY - headerH - stickyH - 12;
    if (window.scrollY > Math.max(0, target) + 4) {
        const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
        window.scrollTo({ top: Math.max(0, target), behavior: reduce ? 'auto' : 'smooth' });
    }
}

// The day tabs stick directly under the header, whose height changes with
// the viewport (one row on desktop, two on a phone).
function syncHeaderOffset() {
    const header = document.querySelector('header');
    if (!header) return;
    document.documentElement.style.setProperty('--header-h', header.offsetHeight + 'px');
}

// initUI, loadSchedule and the 10-minute poll all ask for the same version on
// startup. One shared request instead of three saves two round-trips.
let _versionPromise = null;
function fetchScheduleVersion() {
    if (!_versionPromise) {
        _versionPromise = (async () => {
            // Основной путь: крошечный schedule-meta.json. updated_at меняется
            // только вместе с данными, поэтому 600-КБ таблица не скачивается
            // заново на каждой проверке.
            let metaStatus = 0;
            try {
                const ctrl = new AbortController();
                const timer = setTimeout(() => ctrl.abort(), 1200);
                const res = await fetch(REMOTE_META + '?v=' + Date.now(), {
                    cache: 'no-store',
                    signal: ctrl.signal,
                });
                clearTimeout(timer);
                metaStatus = res.status;
                if (res.ok) {
                    const meta = await res.json();
                    if (meta && meta.updated_at) {
                        return {
                            mod_time: Number(meta.updated_at),
                            checked_at: Number(meta.checked_at) || 0,
                        };
                    }
                }
            } catch (e) {
                // Медленный GitHub не должен задерживать загрузку самой таблицы.
                return null;
            }

            // Фолбэк, если meta ещё не задеплоена (404).
            if (metaStatus !== 404) return null;
            try {
                const res = await fetch(REMOTE_SCHEDULE, { method: 'HEAD', cache: 'no-store' });
                if (!res.ok) return null;
                const lastModified = res.headers.get('Last-Modified');
                return lastModified
                    ? { mod_time: Date.parse(lastModified), checked_at: 0 }
                    : null;
            } catch (e) {
                return null;
            }
        })();
        // let a later poll ask GitHub again
        setTimeout(() => { _versionPromise = null; }, 60 * 1000);
    }
    return _versionPromise;
}

/* ------------------- L1: горячий срез текущей группы ------------------- */

function readHotSlice() {
    try {
        const raw = localStorage.getItem(HOT_SLICE_KEY);
        if (!raw) return null;
        const s = JSON.parse(raw);
        if (!s || s.v !== HOT_SLICE_SCHEMA) return null;
        if (typeof s.g !== 'string' || !s.d || typeof s.d !== 'object') return null;
        return s;
    } catch (e) {
        return null;
    }
}

function paintHotSlice() {
    const slice = readHotSlice();
    if (!slice) return false;
    if (!allGroupsData || !Object.keys(allGroupsData).length || !allGroupsData[slice.g]) {
        allGroupsData = { [slice.g]: slice.d };
    }
    if (!allGroupsData[currentGroup]) currentGroup = slice.g;
    try {
        populateGroupSelect();
        renderQuickGroups();
        renderPinButton();
        renderTabs();
        renderSchedule();
        const checkedAt = parseInt(localStorage.getItem('nkse-checked-at') || '0', 10);
        markStaleness(checkedAt || slice.t || null, true);
        setUpdatedLabel(slice.t || null, checkedAt || 0);
    } catch (e) {
        return false;
    }
    return true;
}

function saveHotSlice() {
    try {
        if (!currentGroup || !allGroupsData || !allGroupsData[currentGroup]) return;
        localStorage.setItem(
            HOT_SLICE_KEY,
            JSON.stringify({
                v: HOT_SLICE_SCHEMA,
                g: currentGroup,
                t: lastModTime || 0,
                d: allGroupsData[currentGroup],
            })
        );
    } catch (e) {
        /* приватный режим или переполнение квоты: работаем без среза */
    }
}

 async function loadSchedule(forceRefresh = false) {
     const container = document.getElementById('schedule-container');
     const lastUpdatedEl = document.getElementById('last-updated');

     // L1: мгновенный кадр из среза текущей группы. Синхронно и до первого
     // await — иначе старт снова упрётся в сеть.
     if (!forceRefresh) paintHotSlice();

     const CACHE_KEY = 'nkse-schedule-cache';
     const TIME_KEY = 'nkse-schedule-time';
     const CACHE_VER_KEY = 'nkse-cache-ver';
     const CACHE_DURATION = 60 * 60 * 1000; // 60 minutes

     // Fetch server mod_time (когда изменились данные) и checked_at
     // (когда парсер последний раз проверял источник).
     let serverModTime = null;
     let serverCheckedAt = 0;
     try {
         const infoData = await fetchScheduleVersion();
         if (infoData) {
             serverModTime = infoData.mod_time;
             serverCheckedAt = infoData.checked_at || 0;
             if (serverCheckedAt) {
                 try { localStorage.setItem('nkse-checked-at', String(serverCheckedAt)); } catch (e) {}
             }
         }
     } catch (e) {}

     // Check cache first
     if (!forceRefresh) {
         try {
             const cached = localStorage.getItem(CACHE_KEY);
             const cachedTime = localStorage.getItem(TIME_KEY);
             const cachedVer = localStorage.getItem(CACHE_VER_KEY);
             const freshByTime = cachedTime && (Date.now() - parseInt(cachedTime) < CACHE_DURATION);
             const verMatches = !serverModTime || (cachedVer !== null && parseFloat(cachedVer) === serverModTime);
             if (cached && freshByTime && verMatches) {
                allGroupsData = JSON.parse(cached);
                populateGroupSelect();
                renderQuickGroups();
                renderPinButton();
                renderDataHealth();
                checkAndAutoSwitchDay();

const cachedFileMtime = localStorage.getItem('nkse-file-mtime');
                  const cachedCheckedAt = parseInt(localStorage.getItem('nkse-checked-at') || '0', 10);
                  markStaleness(cachedCheckedAt || (cachedFileMtime ? parseInt(cachedFileMtime) : null), true);
                  setUpdatedLabel(
                      cachedFileMtime ? parseInt(cachedFileMtime) : serverModTime,
                      cachedCheckedAt || serverCheckedAt
                  );
                  
renderTabs();
                 renderSchedule();
                 checkForUpdates();
                 warmOfflineCache(cached);
                 return;
             }
         } catch (e) {
             console.error('Cache read error:', e);
         }
     }

    container.innerHTML = `
        <div class="col-span-full state-box text-center text-slate-400">
            <div class="inline-block animate-spin rounded-full border-3 border-blue-600 border-t-transparent mb-3" style="width: clamp(1.75rem, 1.2rem + 1.6vw, 3.5rem); height: clamp(1.75rem, 1.2rem + 1.6vw, 3.5rem);"></div>
            <p class="fs-meta font-bold text-slate-600 dark:text-slate-300">Загрузка расписания...</p>
        </div>
    `;

      try {
          // No cache-busting query on the normal path: the service worker is
// network-first, so freshness is unaffected, and a stable URL lets the HTTP
// cache help when the server allows it.
// Данные всегда берём с GitHub Pages: Firebase-версия сайта не хранит
// расписание, поэтому обновление таблицы не требует деплоя Firebase.
          let res;
          try {
              const remoteUrl = forceRefresh ? REMOTE_SCHEDULE + '?_t=' + Date.now() : REMOTE_SCHEDULE;
              res = await fetch(remoteUrl, { cache: forceRefresh ? 'reload' : 'default' });
              if (!res.ok) throw new Error('remote');
          } catch (e) {
              console.warn('[NKSE] GitHub недоступен, беру локальный schedule.json');
              res = await fetch(
                  forceRefresh ? `schedule.json?_t=${Date.now()}` : 'schedule.json',
                  { cache: forceRefresh ? 'reload' : 'default' }
              );
          }

          if (!res.ok) throw new Error('Не удалось загрузить schedule.json');
          
          // Keep the response text as the cache value: parsing it once and
          // storing the source avoids a second 600 KB JSON.stringify pass.
          const rawText = await res.text();
          allGroupsData = JSON.parse(rawText);
          
          // Время изменения данных берём из schedule-meta.json; Last-Modified
          // остаётся фолбэком (и меняется при каждом деплое Pages, поэтому
          // показывать его как «обновлено» нельзя).
          let fileModTime = serverModTime || null;
          const lastModified = res.headers.get('Last-Modified');
          if (!fileModTime && lastModified) {
              fileModTime = new Date(lastModified).getTime();
          }
          
          // Save to cache
          localStorage.setItem(CACHE_KEY, rawText);
          localStorage.setItem(TIME_KEY, Date.now().toString());
          localStorage.setItem(CACHE_VER_KEY, String(serverModTime || 0));
          if (fileModTime) localStorage.setItem('nkse-file-mtime', fileModTime.toString());
          
          populateGroupSelect();
          renderQuickGroups();
          renderPinButton();
          renderDataHealth();
          checkAndAutoSwitchDay();

          markStaleness(serverCheckedAt || fileModTime || null, false);
          setUpdatedLabel(fileModTime || serverModTime, serverCheckedAt);
          
renderTabs();
         renderSchedule();
         checkForUpdates();
         warmOfflineCache(rawText);
         saveHotSlice();
} catch (err) {
         console.error(err);
         uiSound('error');
         if (renderFromStaleCache(err && err.message)) return;
         container.innerHTML = `
             <div class="col-span-full state-box bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-center max-w-lg mx-auto text-red-700 dark:text-red-400">
                 <p class="font-extrabold mb-1">Ошибка загрузки расписания</p>
                <p class="fs-meta text-red-500 mb-4">${err.message}. Проверьте подключение к интернету и попробуйте ещё раз.</p>
                <button onclick="loadSchedule(true)" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 fs-meta font-bold" style="border-radius: var(--radius-sm);">Повторить</button>
             </div>
         `;
     }
 }

// Every group gets its own emoji. The assignment is derived from the group
// name (FNV-1a) and then linearly probed for a free slot, so it stays stable
// across schedule updates and is guaranteed unique across the whole list.
const GROUP_EMOJI_POOL = [
    '🔧', '🔨', '🪛', '⛏️', '🧰', '🔩', '⚙️', '🧲', '🔫', '💡',
    '🔦', '🕯️', '🧪', '⚗️', '🔬', '🔭', '📡', '🛰️', '💻', '⌨️',
    '🖥️', '🖨️', '🖱️', '💾', '💿', '📀', '📷', '📹', '🎥', '📽️',
    '📞', '☎️', '📟', '📠', '📺', '📻', '🎙️', '⏱️', '⏰', '🕰️',
    '⌛', '⏳', '📊', '📈', '📉', '📐', '📏', '📋', '📌', '📎',
    '🖇️', '✂️', '🖊️', '🖌️', '📝', '📔', '📕', '📗', '📘', '📙',
    '📚', '📖', '🔖', '🗂️', '🗃️', '🗄️', '🏗️', '🧱', '⛓️', '🔗',
    '🌵', '🌲', '🌳', '🌴', '🌱', '🌿', '☘️', '🍀', '🍁', '🍂',
    '🍃', '🌾', '🌺', '🌻', '🌹', '🌷', '🌸', '💐', '🌞', '🌝',
    '🌟', '✨', '⚡', '☄️', '🌈', '🌤️', '⛅', '☁️', '🌧️', '⛈️',
    '❄️', '☃️', '💧', '🌊', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉',
    '🍇', '🍓', '🫐', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅',
    '🍆', '🥑', '🥦', '🥬', '🥒', '🌽', '🌶️', '🫑', '🍄', '🥚',
    '🍞', '🧀', '🥓', '🍔', '🍟', '🍕', '🐶', '🐱', '🐭', '🐹',
    '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸',
    '🐵', '🙈', '🙉', '🙊', '🐔', '🐧', '🐦', '🐤', '🦆', '🦅',
    '🦉', '🦇', '🐝', '🐛', '🦋', '🐌', '🐞', '🐜', '⚽', '🏀',
    '🏈', '🏐', '🎾', '🏓', '🏸', '🥊', '🥋', '🎽', '🛷', '⛷️',
    '🏂', '🏋️', '🤼', '🤸', '🤺', '🏌️', '🏇', '🧘', '🏄', '🏊',
    '🤽', '🚣', '🧗', '🚁', '🚂', '🚄', '🚅', '🚆', '🚇', '🚊',
    '🚉', '✈️', '🛫', '🛬', '🚀', '🛸', '🚜', '🚲', '🛴', '🛵',
    '🏍️', '🚗', '🚕', '🚙', '🚌', '🚎', '🏎️', '🚓', '🚑', '🚒',
    '🚚', '🚛', '🎨', '🎭', '🎬', '🎤', '🎧', '🎸', '🎹', '🎺',
    '🎷', '🥁', '🎻', '📯', '🎼', '🎵', '🎶', '🏆', '🥇', '🥈',
    '🥉', '🎯', '🎲', '🎳', '🎮', '🎰', '🧩', '🎁', '🎈', '🎀',
    '🎪', '🤹', '🎓', '👑', '💍', '💎', '🔔', '🎊', '🎉', '💰'
];

// The default group keeps the star it always had.
const RESERVED_GROUP_EMOJI = { 'СЗ-13-26': '⭐' };

let _groupEmojiMap = null;

function buildGroupEmojiMap() {
    const map = {};
    const used = new Set();
    Object.entries(RESERVED_GROUP_EMOJI).forEach(([g, e]) => {
        map[g] = e;
        used.add(e);
    });

    const groups = Object.keys(allGroupsData || {}).sort();
    for (const g of groups) {
        if (map[g]) continue;
        let h = 2166136261;
        for (let i = 0; i < g.length; i++) {
            h ^= g.charCodeAt(i);
            h = Math.imul(h, 16777619);
        }
        let idx = Math.abs(h) % GROUP_EMOJI_POOL.length;
        for (let guard = 0; guard < GROUP_EMOJI_POOL.length && used.has(GROUP_EMOJI_POOL[idx]); guard++) {
            idx = (idx + 1) % GROUP_EMOJI_POOL.length;
        }
        map[g] = GROUP_EMOJI_POOL[idx];
        used.add(GROUP_EMOJI_POOL[idx]);
    }

    _groupEmojiMap = map;
    return map;
}

function groupEmoji(group) {
    if (!_groupEmojiMap) buildGroupEmojiMap();
    return _groupEmojiMap[group] || '';
}

function groupLabel(group) {
    return `${group} ${groupEmoji(group)}`.trim();
}

/* ---------------- teacher index ----------------
   One pass over all groups. Each lesson is split into the teachers who
   actually teach it (subgroups have their own teacher + room), and merged
   lessons in different groups collapse into one entry with several groups. */
function normTeacherName(s) {
    return String(s || '').replace(/\s+/g, ' ').trim();
}

function lessonTeacherInfos(lesson) {
    const subs = Array.isArray(lesson.subgroups) ? lesson.subgroups : [];
    const withTeacher = subs.filter((s) => s && normTeacherName(s.teacher));
    if (withTeacher.length) {
        const multi = subs.length > 1;
        return withTeacher.map((s) => ({
            name: normTeacherName(s.teacher),
            room: String(s.room || '').trim(),
            label: multi ? `П${subs.indexOf(s) + 1}` : ''
        }));
    }
    const rooms = String(lesson.room || '').split(',').map((r) => r.trim()).filter(Boolean);
    return String(lesson.teacher || '')
        .split(/[,&]/)
        .map(normTeacherName)
        .filter(Boolean)
        .map((name) => ({
            name,
            room: rooms.length === 1 ? rooms[0] : String(lesson.room || '').trim(),
            label: ''
        }));
}

function buildTeacherIndex() {
    const index = {};

    for (const group of Object.keys(allGroupsData)) {
        const days = allGroupsData[group] || {};
        for (const day of Object.keys(days)) {
            for (const lesson of days[day] || []) {
                const start = parseStartMinutes(lesson.time);
                for (const info of lessonTeacherInfos(lesson)) {
                    const bucket = index[info.name] || (index[info.name] = {});
                    const entries = bucket[day] || (bucket[day] = []);
                    const key = [start, String(lesson.subject || '').trim().toLowerCase()].join('|');
                    let entry = entries.find((e) => e._key === key);
                    if (!entry) {
                        entry = {
                            _key: key,
                            number: lesson.number,
                            time: lesson.time,
                            subject: lesson.subject,
                            room: info.room,
                            substituted: !!lesson.substituted,
                            groups: [],
                            groupRooms: {},
                            rooms: [],
                            substitutedGroups: [],
                            labels: []
                        };
                        entries.push(entry);
                    }
                    if (!entry.groups.includes(group)) entry.groups.push(group);
                    if (info.room && !entry.groupRooms[group]) entry.groupRooms[group] = info.room;
                    if (info.room && !entry.rooms.includes(info.room)) entry.rooms.push(info.room);
                    if (info.label && !entry.labels.includes(info.label)) entry.labels.push(info.label);
                    if (lesson.substituted) {
                        entry.substituted = true;
                        if (!entry.substitutedGroups.includes(group)) entry.substitutedGroups.push(group);
                    }
                }
            }
        }
    }

    for (const name of Object.keys(index)) {
        for (const day of Object.keys(index[name])) {
            const entries = index[name][day];
            entries.sort(
                (a, b) =>
                    parseStartMinutes(a.time) - parseStartMinutes(b.time) ||
                    String(a.subject || '').localeCompare(String(b.subject || ''), 'ru')
            );
            entries.forEach((e) => {
                delete e._key;
                e.groups.sort((a, b) => a.localeCompare(b, 'ru'));
                if (e.substitutedGroups) e.substitutedGroups.sort((a, b) => a.localeCompare(b, 'ru'));
                if (e.rooms) e.rooms.sort((a, b) => a.localeCompare(b, 'ru'));
                // one shared room can still be shown as a single pill; when the
                // rooms differ every group carries its own room instead
                e.room = e.rooms && e.rooms.length === 1 ? e.rooms[0] : '';
            });
        }
    }

    teacherIndex = index;
    teacherList = Object.keys(index).sort((a, b) => a.localeCompare(b, 'ru'));
    _teacherIndexSource = allGroupsData;
}

function ensureTeacherIndex() {
    if (_teacherIndexSource === allGroupsData && teacherIndex) return;
    buildTeacherIndex();
}

function getTeacherSchedule(name) {
    ensureTeacherIndex();
    return (teacherIndex && teacherIndex[name]) || {};
}

function teacherLessonCount(name) {
    const sched = teacherIndex && teacherIndex[name];
    if (!sched) return 0;
    return Object.keys(sched).reduce((n, day) => n + sched[day].length, 0);
}

let allGroupList = [];
let groupCursor = -1;
/* Подпись последнего отрисованного списка групп/преподавателей: повторное
 * открытие панели без смены фильтра/режима не пересобирает 150+ кнопок. */
let _optionsKey = '';
let _optionsSource = null;

function updatePickerLabel() {
    const label = document.getElementById('group-trigger-label');
    if (label) {
        if (viewMode === 'teacher' && currentTeacher) {
            label.textContent = `👨‍🏫 ${currentTeacher}`;
            label.title = currentTeacher;
        } else {
            label.textContent = groupLabel(currentGroup);
            label.title = currentGroup;
        }
    }
    const trigger = document.getElementById('group-trigger');
    if (trigger) trigger.setAttribute('aria-label', viewMode === 'teacher' ? 'Выбор преподавателя' : 'Выбор группы');
    document.title = viewMode === 'teacher' && currentTeacher
        ? `${currentTeacher} — Расписание НКСЭ`
        : `${currentGroup} — Расписание НКСЭ`;
}

// Keep the address bar shareable: ?group=СЗ-13-26 or ?teacher=Лукша Л В.
function updateViewUrl() {
    try {
        const url = new URL(location.href);
        if (viewMode === 'teacher' && currentTeacher) {
            url.searchParams.delete('group');
            url.searchParams.set('teacher', currentTeacher);
        } else {
            url.searchParams.delete('teacher');
            url.searchParams.set('group', currentGroup);
        }
        history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch (e) {}
}

function populateGroupSelect() {
    const groups = Object.keys(allGroupsData).sort();
    if (groups.length === 0) return;
    allGroupList = groups;
    buildGroupEmojiMap();
    // Only group-only visitors never need the teacher index; build it on the
    // first teacher interaction instead of on every page load (~10 ms).
    if (viewMode === 'teacher') ensureTeacherIndex();

    if (!groups.includes(currentGroup)) {
        currentGroup = groups.includes('СЗ-13-26') ? 'СЗ-13-26' : groups[0];
    }

    // A saved teacher may have left the schedule after an update.
    if (viewMode === 'teacher' && (!currentTeacher || !teacherIndex[currentTeacher])) {
        viewMode = 'group';
        localStorage.setItem(VIEW_MODE_KEY, 'group');
    }

    updatePickerLabel();
    syncPickerModes();
    // 150 кнопок нужны только когда панель реально открыта; при открытии
    // setGroupPickerOpen сам вызывает renderGroupOptions.
    const picker = document.getElementById('group-picker');
    if (picker && picker.classList.contains('is-open')) renderGroupOptions('');
}

function renderGroupOptions(filter) {
    const list = document.getElementById('group-list');
    if (!list) return;
    const q = String(filter || '').trim().toLowerCase();
    const isTeacher = pickerMode === 'teacher';
    if (isTeacher) ensureTeacherIndex();
    const source = isTeacher ? teacherList : allGroupList;
    const selected = isTeacher ? currentTeacher : currentGroup;
    const items = q ? source.filter((x) => x.toLowerCase().includes(q)) : source;

    groupCursor = items.indexOf(selected);

    // Тот же список уже в DOM — не пересобираем (открытие/закрытие панели,
    // повторный вызов после выбора группы и т.п.).
    const key = `${pickerMode}|${q}|${items.length}|${selected}|${source === _optionsSource ? 1 : 0}`;
    if (key === _optionsKey) return;
    _optionsKey = key;
    _optionsSource = source;

    if (items.length === 0) {
        list.innerHTML = '<div class="group-opt" aria-disabled="true">Ничего не найдено</div>';
        return;
    }

    if (isTeacher) {
        list.innerHTML = items
            .map(
                (t) => `<button type="button" class="group-opt" role="option" data-teacher="${escapeHtml(t)}" aria-selected="${t === selected}">
                <span class="g-emoji">👨‍🏫</span><span class="opt-name">${escapeHtml(t)}</span><span class="opt-count">${teacherLessonCount(t)}</span>
            </button>`
            )
            .join('');
    } else {
        list.innerHTML = items
            .map(
                (g) => `<button type="button" class="group-opt" role="option" data-group="${escapeHtml(g)}" aria-selected="${g === selected}">
                <span class="g-emoji">${groupEmoji(g)}</span><span class="opt-name">${escapeHtml(g)}</span>
            </button>`
            )
            .join('');
    }
}

function selectGroup(group) {
    if (!group || !allGroupList.includes(group)) return;
    currentGroup = group;
    viewMode = 'group';
    teacherFromGroup = false;
    localStorage.setItem('selected_group', currentGroup);
    localStorage.setItem(VIEW_MODE_KEY, 'group');
    populateGroupSelect();
    renderPinButton();
    renderQuickGroups();
    renderSchedule();
    saveHotSlice();
    updateViewUrl();
    scrollToScheduleTop();
    uiSound('tap');
}

function selectTeacher(teacher, fromGroup) {
    ensureTeacherIndex();
    if (!teacher || !teacherList.includes(teacher)) return;
    currentTeacher = teacher;
    viewMode = 'teacher';
    teacherFromGroup = !!fromGroup;
    localStorage.setItem(TEACHER_KEY, teacher);
    localStorage.setItem(VIEW_MODE_KEY, 'teacher');

    // Do not open on a day this teacher has no lessons.
    const sched = getTeacherSchedule(teacher);
    if (currentDayFilter !== 'all' && !(sched[currentDayFilter] || []).length) {
        currentDayFilter = 'all';
    }

    updatePickerLabel();
    renderPinButton();
    renderQuickGroups();
    renderTabs();
    renderSchedule();
    updateViewUrl();
    scrollToScheduleTop();
    uiSound('switch');
}

function syncPickerModes() {
    document.querySelectorAll('#group-panel .picker-mode').forEach((btn) => {
        const on = btn.dataset.mode === pickerMode;
        btn.classList.toggle('is-active', on);
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
    });
    const filter = document.getElementById('group-filter');
    if (filter) {
        filter.placeholder = pickerMode === 'teacher' ? 'Найти преподавателя' : 'Найти группу';
        filter.setAttribute('aria-label', pickerMode === 'teacher' ? 'Фильтр преподавателей' : 'Фильтр групп');
    }
    const list = document.getElementById('group-list');
    if (list) list.setAttribute('aria-label', pickerMode === 'teacher' ? 'Список преподавателей' : 'Список групп');
}

function setPickerMode(mode) {
    pickerMode = mode === 'teacher' ? 'teacher' : 'group';
    syncPickerModes();
    const filter = document.getElementById('group-filter');
    const list = document.getElementById('group-list');
    if (filter) filter.value = '';
    if (list) list.scrollTop = 0;
    renderGroupOptions('');
    if (filter) filter.focus();
}

function setGroupPickerOpen(open) {
    const picker = document.getElementById('group-picker');
    if (!picker) return;
    picker.classList.toggle('is-open', open);
    const trigger = document.getElementById('group-trigger');
    if (trigger) trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
        pickerMode = viewMode === 'teacher' ? 'teacher' : 'group';
        syncPickerModes();
        const filter = document.getElementById('group-filter');
        if (filter) {
            filter.value = '';
            renderGroupOptions('');
            filter.focus();
        }
        // jump to the selected item without a smooth scroll on open
        requestAnimationFrame(() => {
            const active = document.querySelector('#group-list .group-opt[aria-selected="true"]');
            if (active) active.scrollIntoView({ block: 'center' });
        });
    }
}

function initGroupPicker() {
    const picker = document.getElementById('group-picker');
    const trigger = document.getElementById('group-trigger');
    const filter = document.getElementById('group-filter');
    const list = document.getElementById('group-list');
    if (!picker || !trigger || !list) return;

    trigger.addEventListener('click', () => {
        const willOpen = !picker.classList.contains('is-open');
        setGroupPickerOpen(willOpen);
        uiSound(willOpen ? 'open' : 'close');
    });

    picker.querySelectorAll('.picker-mode').forEach((btn) => {
        btn.addEventListener('click', () => setPickerMode(btn.dataset.mode));
    });

    if (filter) {
        filter.addEventListener('input', () => renderGroupOptions(filter.value));
        filter.addEventListener('keydown', (e) => {
            const opts = [...list.querySelectorAll('.group-opt[data-group], .group-opt[data-teacher]')];
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                const delta = e.key === 'ArrowDown' ? 1 : -1;
                groupCursor = Math.max(0, Math.min(opts.length - 1, groupCursor + delta));
                opts.forEach((o, i) => o.classList.toggle('is-cursor', i === groupCursor));
                opts[groupCursor] && opts[groupCursor].scrollIntoView({ block: 'nearest' });
            } else if (e.key === 'Enter') {
                e.preventDefault();
                const selected = pickerMode === 'teacher' ? currentTeacher : currentGroup;
                const pick =
                    opts[groupCursor] ||
                    opts.find((o) => o.dataset.teacher === selected || o.dataset.group === selected);
                if (pick) {
                    if (pick.dataset.teacher) selectTeacher(pick.dataset.teacher);
                    else selectGroup(pick.dataset.group);
                    setGroupPickerOpen(false);
                    trigger.focus();
                }
            } else if (e.key === 'Escape') {
                setGroupPickerOpen(false);
                trigger.focus();
            }
        });
    }

    list.addEventListener('click', (e) => {
        const btn = e.target.closest('.group-opt');
        if (!btn) return;
        if (btn.dataset.teacher) selectTeacher(btn.dataset.teacher);
        else if (btn.dataset.group) selectGroup(btn.dataset.group);
        setGroupPickerOpen(false);
        trigger.focus();
    });

    document.addEventListener('click', (e) => {
        if (picker.classList.contains('is-open') && !picker.contains(e.target)) setGroupPickerOpen(false);
    });
}

function checkAndAutoSwitchDay() {
    const todayJsDay = new Date().getDay();
    const todayName = JS_DAYS_MAP[todayJsDay];
    
    if (!todayName || todayName === 'Воскресенье') return;
    
    const todayLessons = viewDayLessons(todayName);
    if (todayLessons.length > 0) {
        const lastLesson = todayLessons[todayLessons.length - 1];
        const parts = lastLesson.time.split('-');
        if (parts.length === 2) {
            const [endH, endM] = parts[1].trim().split(':').map(Number);
            const now = new Date();
            const currentMinutes = now.getHours() * 60 + now.getMinutes();
            const lastEndMinutes = endH * 60 + (endM || 0);
            
            if (currentMinutes > lastEndMinutes) {
                const todayIdx = DAYS_ORDER.indexOf(todayName);
                const nextIdx = (todayIdx + 1) % DAYS_ORDER.length;
                let nextDay = DAYS_ORDER[nextIdx];
                if (nextDay === 'Воскресенье') nextDay = 'Понедельник';
                currentDayFilter = nextDay;
            }
        }
    }
}

function getRelativeDayLabel(targetDayName) {
    const now = new Date();
    const todayJsDay = now.getDay();
    const todayMondayIdx = (todayJsDay + 6) % 7;
    const targetIdx = DAYS_ORDER.indexOf(targetDayName);
    
    if (targetIdx === -1) return '';
    
    let diff = targetIdx - todayMondayIdx;
    if (diff < 0) {
        diff += 7;
    }
    
    if (diff === 0) return '<span class="fs-badge chip-sm bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-extrabold border border-emerald-300/60">Сегодня</span>';
    if (diff === 1) return '<span class="fs-badge chip-sm bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 font-bold border border-blue-300/50">Завтра</span>';
    if (diff === 2) return '<span class="fs-badge chip-sm bg-violet-100 dark:bg-violet-950/80 text-violet-800 dark:text-violet-300 font-bold border border-violet-300/50">Послезавтра</span>';
    
    return '';
}

function isLessonActive(timeStr, lessonDay) {
    const todayJsDay = new Date().getDay();
    const todayName = JS_DAYS_MAP[todayJsDay];
    
    if (lessonDay !== todayName) return false;

    const parts = timeStr.split('-');
    if (parts.length !== 2) return false;

    const parseTime = (str) => {
        const [h, m] = str.trim().split(':').map(Number);
        return h * 60 + (m || 0);
    };

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const startMinutes = parseTime(parts[0]);
    const endMinutes = parseTime(parts[1]);

    return currentMinutes >= startMinutes && currentMinutes <= endMinutes;
}

function isLessonPassed(timeStr, lessonDay) {
    const todayJsDay = new Date().getDay();
    const todayName = JS_DAYS_MAP[todayJsDay];
    
    if (lessonDay !== todayName) return false;

    const parts = timeStr.split('-');
    if (parts.length !== 2) return false;

    const parseTime = (str) => {
        const [h, m] = str.trim().split(':').map(Number);
        return h * 60 + (m || 0);
    };

    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();
    const endMinutes = parseTime(parts[1]);

    return currentMinutes > endMinutes;
}

window.copyRoom = function(roomText, event) {
    event.stopPropagation();
    navigator.clipboard.writeText(roomText).then(() => {
        const btn = event.currentTarget;
        const originalHTML = btn.innerHTML;
        btn.innerHTML = '✅ Скопировано';
        uiSound('success');
        setTimeout(() => {
            btn.innerHTML = originalHTML;
        }, 1500);
    });
}

/* ---------------- "what's happening now" bar ---------------- */
function parseLessonRange(timeStr) {
    const parts = String(timeStr || '').split('-');
    if (parts.length !== 2) return null;
    const toMin = (s) => {
        const [h, m] = s.trim().split(':').map(Number);
        return (h || 0) * 60 + (m || 0);
    };
    return { start: toMin(parts[0]), end: toMin(parts[1]) };
}

function fmtLeft(mins) {
    if (mins < 1) return 'меньше минуты';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    if (h <= 0) return `${m} мин`;
    return `${h} ч ${m} мин`;
}

// Парсер проверяет источник каждые 10 минут днём. Если checked_at не
// обновлялся два часа — что-то действительно сломалось (Actions/CDN), а не
// просто «расписание не менялось».
const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

function markStaleness(modTimeMs, fromCache) {
    const dot = document.getElementById('stale-dot');
    if (!dot) return;
    if (!modTimeMs) {
        dot.hidden = !fromCache;
        dot.title = 'Не удалось определить время обновления данных';
        return;
    }
    const age = Date.now() - modTimeMs;
    if (age > STALE_AFTER_MS) {
        dot.hidden = false;
        const h = Math.round(age / 3600000);
        dot.title = `Данные не обновлялись около ${h} ч. Возможно, парсер не отвечает.`;
    } else {
        dot.hidden = true;
    }
}

function teacherLinksHtml(raw) {
    const names = String(raw || '')
        .split(/[,&]/)
        .map(normTeacherName)
        .filter(Boolean);
    if (!names.length) return '';
    return `<span class="teacher-links fs-meta">${names
        .map(
            (n) => `<button type="button" class="teacher-link" data-open-teacher="${escapeHtml(n)}" title="Открыть расписание: ${escapeHtml(n)}">${escapeHtml(n)}</button>`
        )
        .join(', ')}</span>`;
}

// Lessons for the currently shown day, in either view mode.
function viewDayLessons(dayName) {
    if (viewMode === 'teacher' && currentTeacher) {
        return getTeacherSchedule(currentTeacher)[dayName] || [];
    }
    return (allGroupsData[currentGroup] || {})[dayName] || [];
}

function viewHasData() {
    if (viewMode === 'teacher') {
        return !!currentTeacher && Object.keys(getTeacherSchedule(currentTeacher)).length > 0;
    }
    const group = allGroupsData[currentGroup];
    return !!group && Object.keys(group).length > 0;
}

// First upcoming day (after today) that actually has lessons.
function nextLessonDayInfo() {
    const todayIdx = (new Date().getDay() + 6) % 7; // 0 = Monday
    for (let step = 1; step <= 7; step++) {
        const idx = (todayIdx + step) % 7;
        const name = DAYS_ORDER[idx];
        const list = viewDayLessons(name);
        if (list.length) return { name, list, step };
    }
    return null;
}

function lessonRoomsText(l) {
    if (!l) return '';
    if (l.groupRooms && l.groups && l.groups.length) {
        const rooms = [];
        l.groups.forEach((g) => {
            const r = l.groupRooms[g];
            if (r && !rooms.includes(r)) rooms.push(r);
        });
        if (rooms.length) return rooms.join(', ');
    }
    return l.room || '';
}

// "ОП-12-26 (А418), ПС-11-26 (А420)" plus substitution markers.
function lessonGroupsWithRooms(l) {
    if (!l || !l.groups || !l.groups.length) return '';
    const subs = l.substitutedGroups || [];
    const rooms = l.groupRooms || {};
    return l.groups
        .map((g) => {
            const room = rooms[g];
            return `${g}${room ? ` (${room})` : ''}${subs.includes(g) ? ' (замена)' : ''}`;
        })
        .join(', ');
}

function nextLessonHint() {
    const next = nextLessonDayInfo();
    if (!next) return '';
    const first = next.list[0];
    const when = next.step === 1 ? 'Завтра' : next.name;
    const parts = [`${when}: ${first.subject || 'пара'}`];
    const isTeacherHint = viewMode === 'teacher' && first.groups && first.groups.length;
    if (isTeacherHint) {
        parts.push(lessonGroupsWithRooms(first));
    }
    if (first.time) parts.push(first.time);
    if (!isTeacherHint && first.room) parts.push(`каб. ${first.room}`);
    return parts.join(' · ');
}

/* Последняя отрисовка «сейчас идёт»: перерисовка раз в 30 секунд с тем же
 * содержимым перезапускала пульсацию точки и вызывала лишний reflow. */
let _nowPaint = '';

function paintNowBar(bar, cls, html) {
    const key = cls + '|' + html;
    if (key === _nowPaint) return;
    _nowPaint = key;
    bar.className = cls;
    bar.hidden = false;
    bar.innerHTML = html;
}

function hideNowBar(bar) {
    bar.hidden = true;
    _nowPaint = '';
}

function renderNowBar() {
    const bar = document.getElementById('now-bar');
    if (!bar) return;
    if (!showNowBar) {
        hideNowBar(bar);
        return;
    }
    if (!viewHasData()) {
        hideNowBar(bar);
        return;
    }

    const todayName = JS_DAYS_MAP[new Date().getDay()];
    const lessons = viewDayLessons(todayName);
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();

    if (!todayName || lessons.length === 0) {
        const hint = nextLessonHint();
        if (!hint || !showNowEnded) {
            hideNowBar(bar);
            return;
        }
        paintNowBar(bar, 'now-bar is-free', `
            <span class="now-dot"></span>
            <span>Сегодня пар нет</span>
            <span class="now-left">${escapeHtml(hint)}</span>`);
        return;
    }

    const live = lessons.find((l) => {
        const r = parseLessonRange(l.time);
        return r && cur >= r.start && cur <= r.end;
    });

    if (live) {
        const r = parseLessonRange(live.time);
        const liveRoom = lessonRoomsText(live);
        paintNowBar(bar, 'now-bar is-live', `
            <span class="now-dot"></span>
            <span><b>Идёт сейчас:</b> ${escapeHtml(live.subject || '')}</span>
            ${viewMode === 'teacher' ? `<span>${escapeHtml(lessonGroupsWithRooms(live))}</span>` : ''}
            ${viewMode !== 'teacher' && liveRoom ? `<span>Каб: ${escapeHtml(liveRoom)}</span>` : ''}
            <span class="now-left">до ${String(Math.floor(r.end / 60)).padStart(2, '0')}:${String(r.end % 60).padStart(2, '0')} · осталось ${fmtLeft(r.end - cur)}</span>`);
        return;
    }

    const next = lessons.find((l) => {
        const r = parseLessonRange(l.time);
        return r && r.start > cur;
    });

    if (next) {
        const r = parseLessonRange(next.time);
        const nextRoom = lessonRoomsText(next);
        paintNowBar(bar, 'now-bar is-free', `
            <span class="now-dot"></span>
            <span><b>Следующая пара</b> в ${String(Math.floor(r.start / 60)).padStart(2, '0')}:${String(r.start % 60).padStart(2, '0')}</span>
            <span>${escapeHtml(next.subject || '')}</span>
            ${viewMode === 'teacher' ? `<span>${escapeHtml(lessonGroupsWithRooms(next))}</span>` : ''}
            ${viewMode !== 'teacher' && nextRoom ? `<span>Каб: ${escapeHtml(nextRoom)}</span>` : ''}
            <span class="now-left">через ${fmtLeft(r.start - cur)}</span>`);
        return;
    }

    // Пар больше нет: по умолчанию плашку не показываем, чтобы не мозолила
    // глаза. Включается галочкой «Показывать „пары закончились“».
    if (!showNowEnded) {
        hideNowBar(bar);
        return;
    }
    const hint = nextLessonHint();
    paintNowBar(bar, 'now-bar is-free',
        `<span class="now-dot"></span><span>На сегодня пары закончились</span>` +
        (hint ? `<span class="now-left">${escapeHtml(hint)}</span>` : ''));
}

function initNowBar() {
    renderNowBar();
    setInterval(renderNowBar, 30 * 1000);
}

function dayToText(dayName) {
    const lessons = viewDayLessons(dayName);
    const isTeacher = viewMode === 'teacher' && currentTeacher;
    const lines = [`${isTeacher ? currentTeacher : currentGroup} — ${dayName}`];
    if (lessons.length === 0) {
        lines.push('Занятий нет');
    } else {
        lessons.forEach((l) => {
            let s = `${l.time}  ${l.subject || ''}`;
            if (!isTeacher && l.substituted) s += '  (замена)';
            if (isTeacher) {
                if (l.groups && l.groups.length) {
                    const subGroups = l.substitutedGroups || [];
                    const rooms = l.groupRooms || {};
                    const roomList = l.groups.map((g) => rooms[g] || '');
                    const shared = roomList.length && roomList.every((r) => r && r === roomList[0]) ? roomList[0] : '';
                    const groupsText = l.groups
                        .map((g) => {
                            const room = shared ? '' : rooms[g];
                            return `${g}${room ? ` — ${room}` : ''}${subGroups.includes(g) ? ' (замена)' : ''}`;
                        })
                        .join(', ');
                    s += `  (${groupsText})`;
                    if (shared) s += `  [${shared}]`;
                }
            } else {
                if (l.teacher) s += `  (${l.teacher})`;
                if (l.room) s += `  [${l.room}]`;
            }
            lines.push(s);
        });
    }
    return lines.join('\n');
}

window.copyDay = function(dayName, event) {
    if (event) event.stopPropagation();
    const text = dayToText(dayName);
    const done = () => {
        flashButton(event && event.currentTarget, 'is-ok');
        uiSound('success');
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(() => fallbackCopy(text, done));
    } else {
        fallbackCopy(text, done);
    }
};

// html2canvas is ~200 KB and is only needed when the user actually shares a
// day, so it is no longer a blocking <script> in index.html. It is cached in
// localStorage after the first fetch, which also keeps the share button working
// offline.
const H2C_URL = 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js';
const H2C_KEY = 'nkse-h2c-source';
const OFFLINE_DATA_CACHE = 'nkse-v8-data';

function loadHtml2Canvas() {
    if (window.html2canvas) return Promise.resolve(window.html2canvas);

    let cached = null;
    try { cached = localStorage.getItem(H2C_KEY); } catch (e) {}

    if (cached) {
        return new Promise(function(resolve, reject) {
            try {
                const el = document.createElement('script');
                el.src = H2C_URL;
                el.onload = function() { resolve(window.html2canvas); };
                el.onerror = function() { injectSource(cached).then(resolve, reject); };
                document.head.appendChild(el);
            } catch (e) {
                injectSource(cached).then(resolve, reject);
            }
        });
    }

    return new Promise(function(resolve, reject) {
        const el = document.createElement('script');
        el.src = H2C_URL;
        el.onload = function() {
            try { localStorage.setItem(H2C_KEY, window.html2canvas.toString()); } catch (e) {}
            resolve(window.html2canvas);
        };
        el.onerror = function() { reject(new Error('нет сети и нет сохранённой копии')); };
        document.head.appendChild(el);
    });
}

// Evaluate the saved source when the CDN is unreachable.
function injectSource(source) {
    return new Promise(function(resolve, reject) {
        try {
            const blob = new Blob([source], { type: 'application/javascript' });
            const url = URL.createObjectURL(blob);
            const el = document.createElement('script');
            el.src = url;
            el.onload = function() {
                URL.revokeObjectURL(url);
                if (window.html2canvas) resolve(window.html2canvas);
                else reject(new Error('html2canvas не загрузился'));
            };
            el.onerror = function() {
                URL.revokeObjectURL(url);
                reject(new Error('не удалось запустить сохранённую копию'));
            };
            document.head.appendChild(el);
        } catch (e) {
            reject(e);
        }
    });
}

// Ripple that starts under the pointer. Only transform/opacity are animated,
// the node is removed as soon as the animation ends, and repeated clicks
// restart it instead of stacking elements.
function spawnDayRipple(btn, ev) {
    if (!btn) return;
    if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

    const rect = btn.getBoundingClientRect();
    if (!rect.width) return;

    const prev = btn.querySelector('.day-ripple');
    if (prev) prev.remove();

    const size = Math.max(rect.width, rect.height) * 2.2;
    let x = rect.width / 2;
    let y = rect.height / 2;
    if (ev && typeof ev.clientX === 'number' && (ev.clientX || ev.clientY)) {
        x = ev.clientX - rect.left;
        y = ev.clientY - rect.top;
    }

    const span = document.createElement('span');
    span.className = 'day-ripple';
    span.style.width = size + 'px';
    span.style.height = size + 'px';
    span.style.left = x + 'px';
    span.style.top = y + 'px';
    span.addEventListener('animationend', () => span.remove());
    btn.appendChild(span);
}

function initDayTabRipple() {
    const tabs = document.getElementById('days-tabs');
    if (!tabs) return;
    tabs.addEventListener('click', (ev) => {
        const btn = ev.target.closest ? ev.target.closest('.day-tab') : null;
        if (btn) spawnDayRipple(btn, ev);
    });
}

window.shareDayImage = async function(dayName, event) {
    if (event) event.stopPropagation();
    const btn = event && event.currentTarget;
    const card = document.querySelector('.day-card[data-day="' + dayName.replace(/"/g, '&quot;') + '"]');
    if (!card) return;
    setBusy(btn, true);
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const rootStyles = getComputedStyle(document.documentElement);
    const themeBg = rootStyles.getPropertyValue('--t-bg').trim();
    const bg = themeBg || (dark ? '#000000' : '#ffffff');
    const bgImage = rootStyles.getPropertyValue('--t-bg-image').trim();
    // Same-origin/data backgrounds can be captured safely; a remote image
    // without CORS would taint the canvas and break toBlob().
    const safeBgImage = bgImage && !/url\(\s*["']?https?:\/\//i.test(bgImage) ? bgImage : '';

    const clone = card.cloneNode(true);
    clone.classList.add('exporting');
    clone.style.width = card.offsetWidth + 'px';
    clone.style.margin = '0';
    clone.querySelectorAll('*').forEach(function(n) {
        n.style.animation = 'none';
        n.style.transition = 'none';
        n.style.transform = 'none';
        n.style.maxHeight = 'none';
        n.style.height = 'auto';
        n.style.overflow = 'visible';
    });
    clone.querySelectorAll('.teacher-link, .teacher-group-link').forEach(function(n) {
        n.style.setProperty('background', 'transparent', 'important');
        n.style.setProperty('background-color', 'transparent', 'important');
        n.style.setProperty('border', '0', 'important');
        n.style.setProperty('box-shadow', 'none', 'important');
        n.style.setProperty('color', 'inherit', 'important');
        n.style.setProperty('appearance', 'none');
        n.style.setProperty('-webkit-appearance', 'none');
    });

    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.left = '-99999px';
    wrap.style.top = '0';
    wrap.style.padding = '16px';
    wrap.style.backgroundColor = bg;
    wrap.style.backgroundImage = safeBgImage || 'none';
    wrap.style.backgroundSize = 'cover';
    wrap.style.backgroundPosition = 'center';
    wrap.style.backgroundRepeat = 'no-repeat';
    wrap.appendChild(clone);
    document.body.appendChild(wrap);

    let h2c;
    try {
        h2c = await loadHtml2Canvas();
    } catch (err) {
        if (wrap.parentNode) document.body.removeChild(wrap);
        setBusy(btn, false);
        alert('Не удалось создать картинку: ' + err.message);
        return;
    }

    h2c(wrap, {
        backgroundColor: bg,
        useCORS: true,
        logging: false,
        scale: 2
    }).then(function(canvas) {
        if (wrap.parentNode) document.body.removeChild(wrap);
        return new Promise(function(resolve) {
            canvas.toBlob(resolve, 'image/png');
        });
    }).then(function(blob) {
        if (!blob) return;
        const owner = viewMode === 'teacher' && currentTeacher ? currentTeacher : currentGroup;
        const fileName = dayName + '_' + owner.replace(/\s+/g, '_') + '.png';
        const file = new File([blob], fileName, { type: 'image/png' });
        const shareData = { files: [file], title: dayName, text: owner + ' · ' + dayName };
        if (navigator.canShare && navigator.canShare(shareData)) {
            navigator.share(shareData).catch(function(){});
        } else {
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = fileName;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            setTimeout(function() { URL.revokeObjectURL(a.href); }, 1000);
        }
        uiSound('success');
    }).catch(function(err) {
        if (wrap.parentNode) document.body.removeChild(wrap);
        uiSound('error');
        alert('Не удалось создать картинку: ' + err.message);
    }).finally(function() {
        if (wrap.parentNode) document.body.removeChild(wrap);
        setBusy(btn, false);
        flashButton(btn, 'is-ok');
    });
};

// Icon buttons have no text label to swap, so feedback is done with a class.
// (Assigning btn.textContent here used to delete the button's SVG for good.)
function flashButton(btn, cls, ms) {
    if (!btn) return;
    btn.classList.add(cls);
    setTimeout(function() { btn.classList.remove(cls); }, ms || 1200);
}

function setBusy(btn, on) {
    if (!btn) return;
    btn.classList.toggle('is-busy', !!on);
}

function fallbackCopy(text, done) {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
        document.execCommand('copy');
        done();
    } catch (e) {
        /* clipboard unavailable */
    }
    document.body.removeChild(ta);
}

function renderSchedule() {
    const container = document.getElementById('schedule-container');
    const isTeacher = viewMode === 'teacher' && !!currentTeacher;
    const groupSchedule = isTeacher ? getTeacherSchedule(currentTeacher) : (allGroupsData[currentGroup] || {});

    if (!groupSchedule || Object.keys(groupSchedule).length === 0) {
        container.innerHTML = `
            <div class="col-span-full state-box bg-white dark:bg-cardbg border border-slate-200 dark:border-slate-800 text-center text-slate-500 font-bold">
                <p class="fs-subj">${isTeacher ? `У преподавателя ${escapeHtml(currentTeacher)} нет данных расписания.` : `Для группы ${currentGroup} нет данных расписания.`}</p>
            </div>
        `;
        return;
    }

    renderNowBar();

    let daysToDisplay = Object.keys(groupSchedule);
    if (currentDayFilter !== 'all') {
        daysToDisplay = [currentDayFilter];
    } else {
        // The teacher index is assembled group by group, so its day keys can
        // arrive in any order. Always show the week Monday -> Saturday.
        daysToDisplay.sort((a, b) => {
            const ia = DAYS_ORDER.indexOf(a);
            const ib = DAYS_ORDER.indexOf(b);
            return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
        });
    }

    let htmlContent = '';
    let totalLessonsCount = 0;

    const todayJsDay = new Date().getDay();
    const todayName = JS_DAYS_MAP[todayJsDay];

    daysToDisplay.forEach(dayName => {
        const allLessons = groupSchedule[dayName] || [];
        totalLessonsCount += allLessons.length;

        const isToday = (dayName === todayName);
        // «Скрывать прошедшие пары» действует только на сегодня: прошлые дни
        // в режиме «вся неделя» остаются как были.
        const lessons = hidePastLessons && isToday
            ? allLessons.filter((l) => !isLessonPassed(l.time, dayName))
            : allLessons;
        const hiddenPast = allLessons.length - lessons.length;

        if (currentDayFilter === 'all' && lessons.length === 0 && !hiddenPast) {
            return;
        }

        const dayLabelBadge = getRelativeDayLabel(dayName);
        const subCount = lessons.filter((l) => l.substituted).length;

        htmlContent += `
            <div class="day-card bg-white dark:bg-cardbg border ${isToday && currentDayFilter === 'all' ? 'border-blue-500/80 shadow-md shadow-blue-500/5' : 'border-slate-200/90 dark:border-slate-800'} shadow-xs flex flex-col" data-day="${dayName}">
                <div class="day-head pb-3.5 mb-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 class="fs-day font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0 ${isToday ? 'bg-emerald-500 animate-pulse' : 'bg-blue-600 dark:bg-blue-500'}"></span>
                        <span class="day-name">${dayName}</span>
                        ${dayLabelBadge}
                        ${isTeacher ? `<span class="day-owner">👨‍🏫 ${escapeHtml(currentTeacher)}</span>` : ''}
                    </h3>
                    <div class="day-meta">
                        <span class="fs-badge day-count">${lessonCountLabel(lessons.length)}</span>
                        ${subCount ? `<span class="fs-badge sub-flag">${substitutionLabel(subCount)}</span>` : ''}
                        <div class="day-actions flex items-center gap-2 flex-nowrap shrink-0">
                            <button onclick="copyDay('${dayName}', event)" title="Скопировать день текстом" aria-label="Скопировать день текстом" class="fs-badge day-icon-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                            <button onclick="shareDayImage('${dayName}', event)" title="Поделиться картинкой" aria-label="Поделиться картинкой" class="fs-badge day-icon-btn day-share"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M6 10l6-6 6 6"/><path d="M4 21h16"/></svg></button>
                        </div>
                    </div>
                </div>
                <div class="stack flex-grow">
                    ${lessons.length === 0 ? `
                        <p class="fs-meta text-slate-400 dark:text-slate-500 text-center py-8 font-bold">${hiddenPast ? 'На сегодня пары закончились' : 'Выходной день ☕'}</p>
                    ` : lessons.map((lesson, idx) => {
                        const active = isLessonActive(lesson.time, dayName);
                        const passed = isLessonPassed(lesson.time, dayName);
                        const subGroups = isTeacher && Array.isArray(lesson.substitutedGroups) ? lesson.substitutedGroups : [];
                        // In a merged lesson only some groups may have a substitution;
                        // in that case the "(замена)" marker sits on the group itself,
                        // not on the whole lesson.
                        const allSubstituted = isTeacher
                            ? (lesson.groups && lesson.groups.length ? subGroups.length >= lesson.groups.length : !!lesson.substituted)
                            : !!lesson.substituted;
                        // When one teacher takes several groups in the same slot,
                        // each group can have its own room. Only show one shared
                        // room pill if all groups are really in the same room.
                        const groupRooms = isTeacher ? (lesson.groupRooms || {}) : {};
                        const roomList = isTeacher ? (lesson.groups || []).map((g) => groupRooms[g] || '') : [];
                        const sharedRoom =
                            roomList.length && roomList.every((r) => r && r === roomList[0]) ? roomList[0] : '';
                        const showGroupRooms = isTeacher && !sharedRoom && roomList.some(Boolean);
                        
                        // Theme colours are applied purely in CSS via [data-theme],
                        // so flipping the attribute repaints instantly and can never
                        // desync from a stale render or a cached app.js.
                        let accentClass = `border-l-4 ${CARD_ACCENTS[idx % CARD_ACCENTS.length]}`;
                        if (active) {
                            accentClass = `border-l-4 lesson-card-current`;
                        } else if (passed) {
                            accentClass = `border-l-4 lesson-card-passed`;
                        }
                         
                        return `
                        <div class="lesson-card border transition hover:-translate-y-0.5 duration-200 shadow-none schedule-card ${accentClass}" style="animation-delay: calc(${idx * 0.07}s * var(--anim-speed, 1))">
                            <div class="lesson-head">
                                <span class="fs-badge lesson-num ${active ? 'is-active' : ''}">
                                    ${isTeacher ? '' : `<span class="num">№${lesson.number}</span>`}
                                    <span class="num-time">${lesson.time}</span>
                                </span>
                                ${active ? `<span class="fs-badge live-tag">ИДЕТ СЕЙЧАС</span>` : ''}
                                ${allSubstituted ? `<span class="fs-badge sub-flag" title="Занятие по замене">замена</span>` : ''}
                            </div>

                            <h4 class="fs-subj font-extrabold tracking-tight leading-snug">${lesson.subject}</h4>

                            <div class="lesson-meta">
                                ${isTeacher ? `
                                    <div class="lesson-meta-row${showGroupRooms ? ' is-multi-group' : ''}">
                                        ${lesson.labels && lesson.labels.length ? `<span class="fs-badge sub-tag">${lesson.labels.join(', ')}</span>` : ''}
                                        ${(lesson.groups || []).map((g) => {
                                            const groupSub = lesson.groups.length > 1 && subGroups.includes(g);
                                            const groupRoom = showGroupRooms ? groupRooms[g] : '';
                                            return `<span class="teacher-group"><button type="button" class="teacher-group-link" data-open-group="${escapeHtml(g)}" title="Открыть группу ${escapeHtml(g)}">${groupEmoji(g)} ${escapeHtml(g)}</button>${groupRoom ? `<span class="group-room">&nbsp;· ${escapeHtml(groupRoom)}</span>` : ''}${groupSub ? `<span class="group-sub" title="Занятие по замене">(замена)</span>` : ''}</span>`;
                                        }).join('')}
                                        ${sharedRoom ? `<button onclick="copyRoom('${sharedRoom}', event)" title="Скопировать кабинет" class="room-btn fs-meta meta-item is-room">${sharedRoom}</button>` : ''}
                                    </div>
                                ` : lesson.subgroups && lesson.subgroups.length > 1 ? `
                                    ${lesson.subgroups.map((sub, sIdx) => `
                                        <div class="lesson-meta-row">
                                            <span class="fs-badge sub-tag">П${sIdx + 1}</span>
                                            ${teacherLinksHtml(sub.teacher)}
                                            ${sub.room ? `<button onclick="copyRoom('${sub.room}', event)" title="Скопировать кабинет" class="room-btn fs-meta meta-item is-room">${sub.room}</button>` : ''}
                                        </div>
                                    `).join('')}
                                ` : `
                                    ${teacherLinksHtml(lesson.teacher)}
                                    ${lesson.room ? `<button onclick="copyRoom('${lesson.room}', event)" title="Скопировать кабинет" class="room-btn fs-meta meta-item is-room">${lesson.room}</button>` : ''}
                                `}
                            </div>
                        </div>
                    `;
                    }).join('')}
                </div>
            </div>
        `;
    });

    if (totalLessonsCount === 0 && currentDayFilter !== 'all') {
        const owner = isTeacher ? `преподавателя ${escapeHtml(currentTeacher)}` : `группы ${currentGroup}`;
        container.innerHTML = `
            <div class="col-span-full state-box bg-white dark:bg-cardbg border border-slate-200 dark:border-slate-800 text-center text-slate-700 dark:text-slate-300">
                <div class="fs-day mb-2">🏖️</div>
                <p class="fs-subj font-extrabold">В этот день у ${owner} нет занятий</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = htmlContent;

    container.querySelectorAll('[data-open-teacher]').forEach((btn) => {
        btn.addEventListener('click', () => selectTeacher(btn.dataset.openTeacher, true));
    });

    if (isTeacher) {
        container.querySelectorAll('[data-open-group]').forEach((btn) => {
            btn.addEventListener('click', () => selectGroup(btn.dataset.openGroup));
        });
    }
}

function checkForUpdates(once) {
    _lastCheckAt = performance.now();
    fetchScheduleVersion()
        .then((data) => {
            if (!data || !data.mod_time) return;

            // «Проверено ЧЧ:ММ» должно тикать, даже если расписание не менялось:
            // обновляем подпись на каждой успешной проверке.
            if (data.checked_at) {
                try { localStorage.setItem('nkse-checked-at', String(data.checked_at)); } catch (e) {}
                setUpdatedLabel(data.mod_time, data.checked_at);
            }

            const next = parseFloat(data.mod_time);
            const prev = lastModTime ? parseFloat(lastModTime) : null;

            // Monotonic barrier: a stale CDN/proxy copy must never roll the
            // schedule back in time, even if it arrives after a fresher one.
            if (prev !== null && isFinite(next) && next <= prev) {
                lastModTime = prev;
                return;
            }

            if (prev !== null && next !== prev) {
                console.log('[Update] New schedule detected!');
                // Могли поменять чужую группу: обновляем данные молча и
                // показываем toast только если изменилась текущая.
                const before = JSON.stringify((allGroupsData && allGroupsData[currentGroup]) || null);
                loadSchedule(true).then(() => {
                    const after = JSON.stringify((allGroupsData && allGroupsData[currentGroup]) || null);
                    if (before !== after) showUpdateToast();
                });
            }
            lastModTime = data.mod_time;
        })
        .catch(() => {});

    if (!once) setTimeout(checkForUpdates, 10 * 60 * 1000);
}

// Students keep the tab open for days; background timers are throttled, so the
// schedule is revalidated the moment the tab is actually looked at again.
function revalidateOnReturn() {
    if (document.visibilityState === 'hidden') return;
    // performance.now() монотонен: перевод часов на телефоне не сломает троттлинг
    if (performance.now() - _lastCheckAt < 60 * 1000) return;
    checkForUpdates(true);
}

document.addEventListener('visibilitychange', revalidateOnReturn);
window.addEventListener('focus', revalidateOnReturn);

// Настройки поведения из панели применяются сразу, без перезагрузки.
window.addEventListener('nkse-prefs-changed', () => {
    showNowBar = readPrefBool(PREF_NOW_BAR, true);
    showNowEnded = readPrefBool(PREF_NOW_ENDED, false);
    hidePastLessons = readPrefBool(PREF_HIDE_PAST, false);
    renderNowBar();
    renderSchedule();
});
// телефон вышел из тоннеля
window.addEventListener('online', revalidateOnReturn);
// возврат из bfcache (Safari/Chrome восстанавливают страницу без DOMContentLoaded)
window.addEventListener('pageshow', (event) => {
    if (event.persisted) revalidateOnReturn();
});

function showUpdateToast() {
    const el = document.createElement('div');
    el.className = 'nkse-toast';
    el.textContent = 'Расписание обновилось';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
    requestAnimationFrame(() => el.classList.add('is-in'));
    setTimeout(() => {
        el.classList.remove('is-in');
        setTimeout(() => el.remove(), 400);
    }, 3200);
}
