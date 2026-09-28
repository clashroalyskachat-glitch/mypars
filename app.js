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

function renderPinButton() {
    const btn = document.getElementById('pin-btn');
    if (!btn) return;
    const on = getPinned().includes(currentGroup);
    btn.setAttribute('aria-pressed', on ? 'true' : 'false');
    btn.textContent = on ? 'Открепить' : 'Закрепить';
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

/* ---------------- search across all groups ---------------- */
const DAYS_SEARCH = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота'];

function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
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
    const hits = [];
    for (const group of Object.keys(allGroupsData)) {
        const days = allGroupsData[group];
        for (const day of DAYS_SEARCH) {
            for (const l of days[day] || []) {
                const subs = (l.subgroups || []).map((s) => `${s.teacher || ''} ${s.room || ''}`).join(' ');
                const hay = `${l.subject || ''} ${l.teacher || ''} ${l.room || ''} ${subs}`.toLowerCase();
                if (hay.includes(q)) {
                    hits.push({ group, day, l });
                }
            }
        }
    }
    hits.sort((a, b) => DAYS_SEARCH.indexOf(a.day) - DAYS_SEARCH.indexOf(b.day) || a.group.localeCompare(b.group));

    if (hits.length === 0) {
        box.hidden = false;
        box.innerHTML = `<div class="search-hit"><span class="muted">Ничего не найдено по запросу «${escapeHtml(query.trim())}»</span></div>`;
        return;
    }

    const shown = hits.slice(0, 120);
    box.hidden = false;
    box.innerHTML =
        `<div class="search-hit"><span class="muted">Найдено ${hits.length}${hits.length > shown.length ? `, показаны первые ${shown.length}` : ''}</span></div>` +
        shown
            .map(
                (h) => `
        <div class="search-hit">
            <button class="quick-btn" data-group="${escapeHtml(h.group)}"><b>${escapeHtml(h.group)}</b></button>
            <span>${escapeHtml(h.day)}</span>
            <span class="muted">№${escapeHtml(h.l.number || '')} &bull; ${escapeHtml(h.l.time || '')}</span>
            <b>${escapeHtml(h.l.subject || '')}</b>
            ${h.l.teacher ? `<span class="muted">${escapeHtml(h.l.teacher)}</span>` : ''}
            ${h.l.room ? `<span class="muted">Каб: ${escapeHtml(h.l.room)}</span>` : ''}
        </div>`
            )
            .join('');

    box.querySelectorAll('[data-group]').forEach((b) => {
        b.addEventListener('click', () => {
            currentGroup = b.dataset.group;
            localStorage.setItem('selected_group', currentGroup);
            populateGroupSelect();
            renderPinButton();
            renderQuickGroups();
            clearSearch();
            renderSchedule();
        });
    });
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

function initUI() {
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

    initSearch();

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
                  if (cachedFileMtime) {
                      const modDate = new Date(parseInt(cachedFileMtime));
                      const modStr = modDate.toLocaleDateString('ru-RU') + ' в ' + modDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                      lastUpdatedEl.textContent = `Обновление на сервере: ${modStr}`;
                  } else if (serverModTime) {
                      const modDate = new Date(serverModTime * 1000);
                      const modStr = modDate.toLocaleDateString('ru-RU') + ' в ' + modDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                      lastUpdatedEl.textContent = `Обновление на сервере: ${modStr}`;
                  } else {
                      lastUpdatedEl.textContent = 'Расписание обновляется каждые 6 часов';
                  }
                  
                  renderTabs();
                 renderSchedule();
                 checkForUpdates();
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

          if (fileModTime) {
              const modDate = new Date(fileModTime);
              const modStr = modDate.toLocaleDateString('ru-RU') + ' в ' + modDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
              lastUpdatedEl.textContent = `Обновление на сервере: ${modStr}`;
          } else if (serverModTime) {
              const modDate = new Date(serverModTime * 1000);
              const modStr = modDate.toLocaleDateString('ru-RU') + ' в ' + modDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
              lastUpdatedEl.textContent = `Обновление на сервере: ${modStr}`;
          } else {
              const cachedTime = localStorage.getItem('nkse-file-mtime');
              if (cachedTime) {
                  const modDate = new Date(parseInt(cachedTime));
                  const modStr = modDate.toLocaleDateString('ru-RU') + ' в ' + modDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
                  lastUpdatedEl.textContent = `Обновление на сервере: ${modStr}`;
              } else {
                  lastUpdatedEl.textContent = 'Расписание обновляется каждые 6 часов';
              }
          }
          
          renderTabs();
          renderSchedule();
          checkForUpdates();
     } catch (err) {
         console.error(err);
         container.innerHTML = `
             <div class="col-span-full bg-red-50 dark:bg-red-950/30 border border-red-200 dark:border-red-900 rounded-2xl p-6 text-center max-w-lg mx-auto text-red-700 dark:text-red-400">
                 <p class="font-extrabold mb-1">Ошибка загрузки расписания</p>
                <p class="fs-meta text-red-500 mb-4">${err.message}. Убедитесь, что запущен сервер (server.py).</p>
                <button onclick="loadSchedule(true)" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl fs-meta font-bold">Повторить</button>
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

        htmlContent += `
            <div class="day-card bg-white dark:bg-cardbg border ${isToday && currentDayFilter === 'all' ? 'border-blue-500/80 shadow-md shadow-blue-500/5' : 'border-slate-200/90 dark:border-slate-800'} shadow-xs flex flex-col">
                <div class="flex items-center justify-between gap-2 flex-wrap pb-3.5 mb-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 class="fs-day font-extrabold text-slate-900 dark:text-white flex items-center gap-2.5 min-w-0">
                        <span class="w-3 h-3 rounded-full shrink-0 ${isToday ? 'bg-emerald-500 animate-pulse' : 'bg-blue-600 dark:bg-blue-500'}"></span>
                        <span class="truncate">${dayName}</span>
                        ${dayLabelBadge}
                    </h3>
                    <span class="fs-badge chip shrink-0 bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold border border-slate-200 dark:border-slate-700">${lessons.length} пар(ы)</span>
                </div>
                <div class="stack flex-grow">
                    ${lessons.length === 0 ? `
                        <p class="fs-meta text-slate-400 dark:text-slate-500 text-center py-8 font-bold">Выходной день ☕</p>
                    ` : lessons.map((lesson, idx) => {
                        const active = isLessonActive(lesson.time, dayName);
                        const passed = isLessonPassed(lesson.time, dayName);
                        
                         var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
                         let bgClass = isDark ? 'bg-black' : 'bg-white';
                         let borderClass = isDark ? 'border-white' : 'border-black';
                         let textClass = isDark ? 'text-white' : 'text-black';
                         let hoverClass = isDark ? 'hover:bg-black' : 'hover:bg-slate-50';
                         
                         let accentClass = `border-l-4 ${CARD_ACCENTS[idx % CARD_ACCENTS.length]} ${bgClass} ${borderClass} ${hoverClass}`;
                         if (active) {
                             accentClass = `border-l-4 border-l-white ${bgClass} ring-0 shadow-none scale-100`;
                         } else if (passed) {
                             accentClass = `border-l-4 border-l-white opacity-100 ${bgClass}`;
                         }
                         
                        return `
                        <div class="lesson-card border ${borderClass} transition hover:-translate-y-0.5 duration-200 shadow-none schedule-card ${accentClass}" style="animation-delay: ${idx * 0.05}s">
                            <div class="lesson-head">
                                <span class="fs-badge chip font-extrabold ${active ? `bg-black ${textClass} border ${borderClass}` : `${textClass} ${bgClass} border ${borderClass}`} tracking-wide">
                                    №${lesson.number} &bull; ${lesson.time}
                                </span>
                                ${active ? `<span class="fs-badge chip-sm live-tag font-extrabold ${textClass} ${bgClass} border ${borderClass}">ИДЕТ СЕЙЧАС</span>` : ''}
                            </div>

                            <h4 class="fs-subj font-extrabold ${textClass} tracking-tight leading-snug">${lesson.subject}</h4>

                            <div class="lesson-meta">
                                ${lesson.subgroups && lesson.subgroups.length > 1 ? `
                                    ${lesson.subgroups.map((sub, sIdx) => `
                                        <div class="lesson-meta-row">
                                            <span class="fs-badge chip-sm font-extrabold uppercase ${bgClass} ${textClass} border ${borderClass}">П${sIdx + 1}</span>
                                            ${sub.teacher ? `<span class="fs-meta chip font-semibold ${textClass} ${bgClass} border ${borderClass}">👨‍🏫 ${sub.teacher}</span>` : ''}
                                            ${sub.room ? `<button onclick="copyRoom('${sub.room}', event)" title="Кликните, чтобы скопировать кабинет" class="room-btn fs-meta chip font-bold ${textClass} ${bgClass} border ${borderClass} shadow-none cursor-pointer whitespace-nowrap">Каб: ${sub.room} 📋</button>` : ''}
                                        </div>
                                    `).join('')}
                                ` : `
                                    ${lesson.teacher ? `<span class="fs-meta chip font-semibold ${textClass} ${bgClass} border ${borderClass}">👨‍🏫 ${lesson.teacher}</span>` : ''}
                                    ${lesson.room ? `<button onclick="copyRoom('${lesson.room}', event)" title="Кликните, чтобы скопировать кабинет" class="room-btn fs-meta chip font-bold ${textClass} ${bgClass} border ${borderClass} shadow-none cursor-pointer whitespace-nowrap">Каб: ${lesson.room} 📋</button>` : ''}
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
