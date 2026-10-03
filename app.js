// Логика приложения для расписания НКСЭ (все группы)

let allGroupsData = {};
let currentGroup = localStorage.getItem('selected_group') || 'СЗ-13-26';
let currentDayFilter = 'all';
let lastModTime = null;

const PIN_KEY = 'nkse-pinned-groups';

/* ?group=СЗ-13-26 — lets a classmate share a link straight to their group */
(function applyGroupFromUrl() {
    try {
        const g = new URLSearchParams(location.search).get('group');
        if (g) {
            currentGroup = g;
            localStorage.setItem('selected_group', g);
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

function togglePin() {
    const pinned = getPinned();
    const i = pinned.indexOf(currentGroup);
    if (i === -1) {
        pinned.push(currentGroup);
    } else {
        pinned.splice(i, 1);
    }
    setPinned(pinned);
}

// "Обновление на сервере: 02.10.2026 в 20:44" -> "Обновлено 02.10 · 20:44".
// Accepts either ms or s; anything falsy means "we do not know yet".
function formatUpdatedLabel(modTime) {
    if (!modTime) return 'Обновляется каждые 6 часов';
    const ms = modTime < 1e11 ? modTime * 1000 : modTime;
    const d = new Date(ms);
    if (isNaN(d.getTime())) return 'Обновляется каждые 6 часов';
    const date = d.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit' });
    const time = d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
    return `Обновлено ${date} · ${time}`;
}

function setUpdatedLabel(modTime) {
    const el = document.getElementById('last-updated');
    if (el) el.textContent = formatUpdatedLabel(modTime);
}

function renderPinButton() {
    const btn = document.getElementById('pin-btn');
    if (!btn) return;
    const on = getPinned().includes(currentGroup);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.classList.toggle('is-on', on);
    btn.title = on ? 'Открепить группу' : 'Закрепить группу';
}

function renderQuickGroups() {
    const bar = document.getElementById('quick-groups');
    if (!bar) return;
    const pinned = getPinned();
    if (pinned.length === 0) {
        bar.innerHTML = '';
        return;
    }
    const available = pinned.filter((g) => allGroupsData[g]);
    bar.innerHTML = available
        .map(
            (g) =>
                `<button class="quick-btn" data-group="${g}" aria-current="${g === currentGroup}">${g}</button>`
        )
        .join('');
    bar.querySelectorAll('.quick-btn').forEach((b) => {
        b.addEventListener('click', () => {
            currentGroup = b.dataset.group;
            localStorage.setItem('selected_group', currentGroup);
            populateGroupSelect();
            renderQuickGroups();
            renderPinButton();
            renderSchedule();
        });
    });
}

/* ---------------- "what's happening now" bar ---------------- */
const DAYS_SEARCH = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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

                // "&"-joined teacher lists belong to one physical lesson
                String(l.teacher || '').split('&').forEach((t) => {
                    const name = t.trim();
                    if (name && !slot.teachers.includes(name)) slot.teachers.push(name);
                });
                (l.subgroups || []).forEach((s) => {
                    const name = String((s && s.teacher) || '').trim();
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

    if (hits.length === 0) {
        box.hidden = false;
        box.innerHTML = `<div class="search-hit"><span class="muted">Ничего не найдено по запросу «${escapeHtml(query.trim())}»</span></div>`;
        return;
    }

    const shown = hits.slice(0, 120);
    box.hidden = false;
    box.innerHTML =
        `<div class="search-hit"><span class="muted">Найдено уроков: ${hits.length}${hits.length > shown.length ? `, показаны первые ${shown.length}` : ''}</span></div>` +
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
            .join('');

    box.querySelectorAll('[data-group]').forEach((b) => {
        b.addEventListener('click', () => {
            currentGroup = b.dataset.group;
            localStorage.setItem('selected_group', currentGroup);
            populateGroupSelect();
            renderPinButton();
            renderQuickGroups();
            clearSearch();
            // jump straight to the matched day when the hit carries one
            if (b.dataset.day && DAYS_ORDER.indexOf(b.dataset.day) !== -1) {
                currentDayFilter = b.dataset.day;
                renderTabs();
            }
            renderSchedule();
        });
    });
}

// Keep a copy of schedule.json inside Cache Storage even when the page was
// painted from localStorage. Without this the service worker has no data to
// fall back on, and the first offline load after the localStorage copy went
// stale shows the "ошибка загрузки" screen.
function warmOfflineCache() {
    if (!('caches' in window)) return;
    const url = 'schedule.json';
    caches.open(OFFLINE_DATA_CACHE).then((cache) =>
        cache.match(url).then((hit) => {
            if (hit) return null;
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

function initSearch() {
    const input = document.getElementById('search-input');
    const reset = document.getElementById('search-reset');
    if (!input) return;
    input.addEventListener('input', () => {
        reset.hidden = input.value.length === 0;
        runSearch(input.value);
    });
    if (reset) {
        reset.addEventListener('click', () => {
            clearSearch();
            input.focus();
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

    fetch('/api/schedule-version')
        .then(res => res.json())
        .then(data => { lastModTime = data.mod_time; })
        .catch(() => { lastModTime = 0; });

    const groupSelect = document.getElementById('group-select');
    groupSelect.addEventListener('change', (e) => {
        currentGroup = e.target.value;
        localStorage.setItem('selected_group', currentGroup);
        renderPinButton();
        renderQuickGroups();
        renderSchedule();
    });

    const pinBtn = document.getElementById('pin-btn');
    if (pinBtn) pinBtn.addEventListener('click', togglePin);

    initNowBar();

    initSearch();
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
}

 function renderTabs() {
     const tabsContainer = document.getElementById('days-tabs');
     var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
     var activeBg = isDark ? '' : 'bg-blue-600';
     var activeText = isDark ? 'text-purple-400 border-purple-400' : 'text-white';
     var inactiveText = isDark ? 'text-gray-400' : 'text-slate-600';
     tabsContainer.innerHTML = DAYS_OF_WEEK.map(day => `
         <button onclick="filterDay('${day.id}')" 
             class="day-tab whitespace-nowrap transition-all duration-300 flex-shrink-0 font-bold ${currentDayFilter === day.id ? activeBg + ' ' + activeText + ' day-tab-active' : inactiveText}">
             ${day.name}
         </button>
     `).join('');

     setTimeout(() => {
         const activeTab = tabsContainer.querySelector(`button[onclick="filterDay('${currentDayFilter}')"]`);
         if (activeTab) {
             activeTab.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' });
         }
     }, 100);
 }

window.filterDay = function(dayId) {
    currentDayFilter = dayId;
    renderTabs();
    renderSchedule();
}

 async function loadSchedule(forceRefresh = false) {
     const container = document.getElementById('schedule-container');
     const lastUpdatedEl = document.getElementById('last-updated');
     
     const CACHE_KEY = 'nkse-schedule-cache';
     const TIME_KEY = 'nkse-schedule-time';
     const CACHE_VER_KEY = 'nkse-cache-ver';
     const CACHE_DURATION = 60 * 60 * 1000; // 60 minutes

     // Fetch server mod_time
     let serverModTime = null;
     try {
         const infoRes = await fetch('/api/schedule-version');
         if (infoRes.ok) {
             const infoData = await infoRes.json();
             serverModTime = infoData.mod_time;
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
                  markStaleness(cachedFileMtime ? parseInt(cachedFileMtime) : null, true);
                  setUpdatedLabel(cachedFileMtime ? parseInt(cachedFileMtime) : serverModTime);
                  
renderTabs();
                 renderSchedule();
                 checkForUpdates();
                 warmOfflineCache();
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
          const res = await fetch(`schedule.json?_t=${forceRefresh ? Date.now() : Math.floor(Date.now() / (1000 * 60 * 15))}`);
          if (!res.ok) throw new Error('Не удалось загрузить schedule.json');
          
          allGroupsData = await res.json();
          
          // Get last-modified from headers
          let fileModTime = null;
          const lastModified = res.headers.get('Last-Modified');
          if (lastModified) {
              fileModTime = new Date(lastModified).getTime();
          }
          
          // Save to cache
          localStorage.setItem(CACHE_KEY, JSON.stringify(allGroupsData));
          localStorage.setItem(TIME_KEY, Date.now().toString());
          localStorage.setItem(CACHE_VER_KEY, String(serverModTime || 0));
          if (fileModTime) localStorage.setItem('nkse-file-mtime', fileModTime.toString());
          
          populateGroupSelect();
          renderQuickGroups();
          renderPinButton();
          renderDataHealth();
          checkAndAutoSwitchDay();

          markStaleness(fileModTime || null, false);
          setUpdatedLabel(fileModTime || serverModTime);
          
renderTabs();
         renderSchedule();
         checkForUpdates();
         warmOfflineCache();
} catch (err) {
         console.error(err);
         if (renderFromStaleCache(err && err.message)) return;
         container.innerHTML = `
             <div class="col-span-full state-box bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 text-center max-w-lg mx-auto text-red-700 dark:text-red-400">
                 <p class="font-extrabold mb-1">Ошибка загрузки расписания</p>
                <p class="fs-meta text-red-500 mb-4">${err.message}. Убедитесь, что запущен сервер (server.py).</p>
                <button onclick="loadSchedule(true)" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 fs-meta font-bold" style="border-radius: var(--radius-sm);">Повторить</button>
             </div>
         `;
     }
 }

function populateGroupSelect() {
    const groupSelect = document.getElementById('group-select');
    const groups = Object.keys(allGroupsData).sort();
    
    if (groups.length === 0) return;

    if (!groups.includes(currentGroup)) {
        currentGroup = groups.includes('СЗ-13-26') ? 'СЗ-13-26' : groups[0];
    }

    groupSelect.innerHTML = groups.map(g => `
        <option value="${g}" ${g === currentGroup ? 'selected' : ''}>${g} ${g === 'СЗ-13-26' ? '⭐' : ''}</option>
    `).join('');
}

function checkAndAutoSwitchDay() {
    const groupSchedule = allGroupsData[currentGroup] || {};
    const todayJsDay = new Date().getDay();
    const todayName = JS_DAYS_MAP[todayJsDay];
    
    if (!todayName || todayName === 'Воскресенье') return;
    
    const todayLessons = groupSchedule[todayName] || [];
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

const STALE_AFTER_MS = 6 * 60 * 60 * 1000; // match the cloud re-parse cadence

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

function renderNowBar() {
    const bar = document.getElementById('now-bar');
    if (!bar) return;
    const todayName = JS_DAYS_MAP[new Date().getDay()];
    const lessons = (allGroupsData[currentGroup] || {})[todayName] || [];
    const now = new Date();
    const cur = now.getHours() * 60 + now.getMinutes();

    if (!todayName || todayName === 'Воскресенье' || lessons.length === 0) {
        bar.hidden = true;
        return;
    }

    const live = lessons.find((l) => {
        const r = parseLessonRange(l.time);
        return r && cur >= r.start && cur <= r.end;
    });

    if (live) {
        const r = parseLessonRange(live.time);
        bar.hidden = false;
        bar.className = 'now-bar is-live';
        bar.innerHTML = `
            <span class="now-dot"></span>
            <span><b>Идёт сейчас:</b> ${live.subject || ''}</span>
            ${live.room ? `<span>Каб: ${live.room}</span>` : ''}
            <span class="now-left">до ${String(Math.floor(r.end / 60)).padStart(2, '0')}:${String(r.end % 60).padStart(2, '0')} · осталось ${fmtLeft(r.end - cur)}</span>`;
        return;
    }

    const next = lessons.find((l) => {
        const r = parseLessonRange(l.time);
        return r && r.start > cur;
    });

    if (next) {
        const r = parseLessonRange(next.time);
        bar.hidden = false;
        bar.className = 'now-bar is-free';
        bar.innerHTML = `
            <span class="now-dot"></span>
            <span><b>Следующая пара</b> в ${String(Math.floor(r.start / 60)).padStart(2, '0')}:${String(r.start % 60).padStart(2, '0')}</span>
            <span>${next.subject || ''}</span>
            ${next.room ? `<span>Каб: ${next.room}</span>` : ''}
            <span class="now-left">через ${fmtLeft(r.start - cur)}</span>`;
        return;
    }

    bar.hidden = false;
    bar.className = 'now-bar is-free';
    bar.innerHTML = `<span class="now-dot"></span><span>На сегодня пары закончились</span>`;
}

function initNowBar() {
    renderNowBar();
    setInterval(renderNowBar, 30 * 1000);
}

function dayToText(dayName) {
    const lessons = (allGroupsData[currentGroup] || {})[dayName] || [];
    const lines = [`${currentGroup} — ${dayName}`];
    if (lessons.length === 0) {
        lines.push('Занятий нет');
    } else {
        lessons.forEach((l) => {
            let s = `${l.time}  ${l.subject || ''}`;
            if (l.substituted) s += '  (замена)';
            if (l.teacher) s += `  (${l.teacher})`;
            if (l.room) s += `  [${l.room}]`;
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
const OFFLINE_DATA_CACHE = 'nkse-v7-data';

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

window.shareDayImage = async function(dayName, event) {
    if (event) event.stopPropagation();
    const btn = event && event.currentTarget;
    const card = document.querySelector('.day-card[data-day="' + dayName.replace(/"/g, '&quot;') + '"]');
    if (!card) return;
    setBusy(btn, true);
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const bg = dark ? '#0B0F19' : '#ffffff';

    const clone = card.cloneNode(true);
    clone.classList.add('exporting');
    clone.style.width = card.offsetWidth + 'px';
    clone.style.margin = '0';
    clone.querySelectorAll('*').forEach(function(n) {
        n.style.animation = 'none';
        n.style.transition = 'none';
        n.style.opacity = '1';
        n.style.transform = 'none';
        n.style.maxHeight = 'none';
        n.style.height = 'auto';
        n.style.overflow = 'visible';
    });

    const wrap = document.createElement('div');
    wrap.style.position = 'fixed';
    wrap.style.left = '-99999px';
    wrap.style.top = '0';
    wrap.style.padding = '16px';
    wrap.style.background = bg;
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

    h2c(clone, {
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
        const fileName = dayName + '_' + currentGroup + '.png';
        const file = new File([blob], fileName, { type: 'image/png' });
        const shareData = { files: [file], title: dayName, text: currentGroup + ' · ' + dayName };
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
    }).catch(function(err) {
        if (wrap.parentNode) document.body.removeChild(wrap);
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
    const groupSchedule = allGroupsData[currentGroup] || {};

    if (!groupSchedule || Object.keys(groupSchedule).length === 0) {
        container.innerHTML = `
            <div class="col-span-full state-box bg-white dark:bg-cardbg border border-slate-200 dark:border-slate-800 text-center text-slate-500 font-bold">
                <p class="fs-subj">Для группы ${currentGroup} нет данных расписания.</p>
            </div>
        `;
        return;
    }

    renderNowBar();

    let daysToDisplay = Object.keys(groupSchedule);
    if (currentDayFilter !== 'all') {
        daysToDisplay = [currentDayFilter];
    }

    let htmlContent = '';
    let totalLessonsCount = 0;

    const todayJsDay = new Date().getDay();
    const todayName = JS_DAYS_MAP[todayJsDay];

    daysToDisplay.forEach(dayName => {
        const lessons = groupSchedule[dayName] || [];
        totalLessonsCount += lessons.length;
        
        if (currentDayFilter === 'all' && lessons.length === 0) {
            return;
        }

        const isToday = (dayName === todayName);
        const dayLabelBadge = getRelativeDayLabel(dayName);
        const subCount = lessons.filter((l) => l.substituted).length;

        htmlContent += `
            <div class="day-card bg-white dark:bg-cardbg border ${isToday && currentDayFilter === 'all' ? 'border-blue-500/80 shadow-md shadow-blue-500/5' : 'border-slate-200/90 dark:border-slate-800'} shadow-xs flex flex-col" data-day="${dayName}">
                <div class="flex items-center justify-between gap-2 flex-nowrap pb-3.5 mb-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 class="fs-day font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0 ${isToday ? 'bg-emerald-500 animate-pulse' : 'bg-blue-600 dark:bg-blue-500'}"></span>
                        <span class="truncate">${dayName}</span>
                        ${dayLabelBadge}
                    </h3>
                    <div class="day-actions flex items-center gap-2 flex-nowrap shrink-0 ml-auto">
                        <span class="fs-badge day-count">${lessons.length} ${lessons.length === 1 ? 'пара' : lessons.length < 5 ? 'пары' : 'пар(ы)'}</span>
                        ${subCount ? `<span class="fs-badge sub-flag">${subCount} ${subCount === 1 ? 'замена' : 'замены'}</span>` : ''}
                        <button onclick="copyDay('${dayName}', event)" title="Скопировать день текстом" aria-label="Скопировать день текстом" class="fs-badge day-icon-btn"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg></button>
                        <button onclick="shareDayImage('${dayName}', event)" title="Поделиться картинкой" aria-label="Поделиться картинкой" class="fs-badge day-icon-btn day-share"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4"/><path d="M6 10l6-6 6 6"/><path d="M4 21h16"/></svg></button>
                    </div>
                </div>
                <div class="stack flex-grow">
                    ${lessons.length === 0 ? `
                        <p class="fs-meta text-slate-400 dark:text-slate-500 text-center py-8 font-bold">Выходной день ☕</p>
                    ` : lessons.map((lesson, idx) => {
                        const active = isLessonActive(lesson.time, dayName);
                        const passed = isLessonPassed(lesson.time, dayName);
                        
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
                        <div class="lesson-card border transition hover:-translate-y-0.5 duration-200 shadow-none schedule-card ${accentClass}" style="animation-delay: ${idx * 0.07}s">
                            <div class="lesson-head">
                                <span class="fs-badge lesson-num ${active ? 'is-active' : ''}">
                                    <span class="num">№${lesson.number}</span>
                                    <span class="num-time">${lesson.time}</span>
                                </span>
                                ${active ? `<span class="fs-badge live-tag">ИДЕТ СЕЙЧАС</span>` : ''}
                                ${lesson.substituted ? `<span class="fs-badge sub-flag" title="Занятие по замене">замена</span>` : ''}
                            </div>

                            <h4 class="fs-subj font-extrabold tracking-tight leading-snug">${lesson.subject}</h4>

                            <div class="lesson-meta">
                                ${lesson.subgroups && lesson.subgroups.length > 1 ? `
                                    ${lesson.subgroups.map((sub, sIdx) => `
                                        <div class="lesson-meta-row">
                                            <span class="fs-badge sub-tag">П${sIdx + 1}</span>
                                            ${sub.teacher ? `<span class="fs-meta meta-item">${sub.teacher}</span>` : ''}
                                            ${sub.room ? `<button onclick="copyRoom('${sub.room}', event)" title="Скопировать кабинет" class="room-btn fs-meta meta-item is-room">${sub.room}</button>` : ''}
                                        </div>
                                    `).join('')}
                                ` : `
                                    ${lesson.teacher ? `<span class="fs-meta meta-item">${lesson.teacher}</span>` : ''}
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
        container.innerHTML = `
            <div class="col-span-full state-box bg-white dark:bg-cardbg border border-slate-200 dark:border-slate-800 text-center text-slate-700 dark:text-slate-300">
                <div class="fs-day mb-2">🏖️</div>
                <p class="fs-subj font-extrabold">В этот день у группы ${currentGroup} нет занятий</p>
            </div>
        `;
        return;
    }
    
    container.innerHTML = htmlContent;
}

function checkForUpdates() {
    fetch('/api/schedule-version')
        .then(res => res.json())
        .then(data => {
            if (data.mod_time && lastModTime && data.mod_time !== lastModTime) {
                console.log('[Update] New schedule detected!');
                loadSchedule(true);
            }
            lastModTime = data.mod_time;
        })
        .catch(() => {});
    
    setTimeout(checkForUpdates, 10 * 60 * 1000);
}
