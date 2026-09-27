// Логика приложения для расписания НКСЭ (все группы)

let allGroupsData = {};
let currentGroup = localStorage.getItem('selected_group') || 'СЗ-13-26';
let currentDayFilter = 'all';
let lastModTime = null;

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

document.addEventListener('DOMContentLoaded', () => {
    const todayJsDay = new Date().getDay();
    const todayName = JS_DAYS_MAP[todayJsDay];
    currentDayFilter = (todayName && todayName !== 'Воскресенье') ? todayName : 'Понедельник';

    initUI();
    loadSchedule();
});

function initUI() {
    fetch('/api/schedule-version')
        .then(res => res.json())
        .then(data => { lastModTime = data.mod_time; })
        .catch(() => { lastModTime = 0; });

    const groupSelect = document.getElementById('group-select');
    groupSelect.addEventListener('change', (e) => {
        currentGroup = e.target.value;
        localStorage.setItem('selected_group', currentGroup);
        renderSchedule();
    });

    renderTabs();
}

 function renderTabs() {
     const tabsContainer = document.getElementById('days-tabs');
     var isDark = document.documentElement.getAttribute('data-theme') === 'dark';
     var activeBg = isDark ? '' : 'bg-blue-600';
     var activeText = isDark ? 'text-purple-400 border-purple-400' : 'text-white';
     var inactiveText = isDark ? 'text-gray-400' : 'text-slate-600';
     tabsContainer.innerHTML = DAYS_OF_WEEK.map(day => `
         <button onclick="filterDay('${day.id}')" 
             class="day-tab px-4 py-2.5 rounded-xl text-xs sm:text-sm whitespace-nowrap transition-all duration-300 flex-shrink-0 font-bold ${currentDayFilter === day.id ? activeBg + ' ' + activeText + ' day-tab-active' : inactiveText}"
             >
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
              if (cached && cachedTime && (Date.now() - parseInt(cachedTime) < CACHE_DURATION)) {
                  allGroupsData = JSON.parse(cached);
                  populateGroupSelect();
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
         <div class="col-span-full py-24 text-center text-slate-400">
             <div class="inline-block animate-spin rounded-full h-8 w-8 border-3 border-blue-600 border-t-transparent mb-3"></div>
             <p class="text-sm font-bold text-slate-600 dark:text-slate-300">Загрузка расписания...</p>
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
          if (fileModTime) localStorage.setItem('nkse-file-mtime', fileModTime.toString());
          
          populateGroupSelect();
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
                 <p class="text-xs text-red-500 mb-4">${err.message}. Убедитесь, что запущен сервер (server.py).</p>
                 <button onclick="loadSchedule(true)" class="bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-bold">Повторить</button>
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
    
    if (diff === 0) return '<span class="text-xs bg-emerald-100 dark:bg-emerald-950/80 text-emerald-800 dark:text-emerald-300 font-extrabold px-2.5 py-0.5 rounded-md border border-emerald-300/60">Сегодня</span>';
    if (diff === 1) return '<span class="text-xs bg-blue-100 dark:bg-blue-950/80 text-blue-800 dark:text-blue-300 font-bold px-2 py-0.5 rounded-md border border-blue-300/50">Завтра</span>';
    if (diff === 2) return '<span class="text-xs bg-violet-100 dark:bg-violet-950/80 text-violet-800 dark:text-violet-300 font-bold px-2 py-0.5 rounded-md border border-violet-300/50">Послезавтра</span>';
    
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
            <div class="col-span-full bg-white dark:bg-cardbg border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-slate-500 font-bold">
                <p>Для группы ${currentGroup} нет данных расписания.</p>
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
            <div class="bg-white dark:bg-cardbg border ${isToday && currentDayFilter === 'all' ? 'border-blue-500/80 shadow-md shadow-blue-500/5' : 'border-slate-200/90 dark:border-slate-800'} rounded-2xl p-5 shadow-xs flex flex-col">
                <div class="flex items-center justify-between pb-3.5 mb-4 border-b border-slate-100 dark:border-slate-800">
                    <h3 class="font-extrabold text-base sm:text-lg text-slate-900 dark:text-white flex items-center gap-2.5">
                        <span class="w-3 h-3 rounded-full ${isToday ? 'bg-emerald-500 animate-pulse' : 'bg-blue-600 dark:bg-blue-500'}"></span>
                        <span>${dayName}</span>
                        ${dayLabelBadge}
                    </h3>
                    <span class="text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold px-3 py-1 rounded-lg border border-slate-200 dark:border-slate-700">${lessons.length} пар(ы)</span>
                </div>
                <div class="space-y-3.5 flex-grow">
                    ${lessons.length === 0 ? `
                        <p class="text-xs text-slate-400 dark:text-slate-500 text-center py-8 font-bold">Выходной день ☕</p>
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
                        <div class="border ${borderClass} rounded-xl p-4 transition hover:-translate-y-0.5 duration-200 shadow-none schedule-card ${accentClass}" style="animation-delay: ${idx * 0.05}s">
                             <div class="flex flex-col gap-2.5">
                                 <div class="flex items-center justify-between gap-2">
                                     <span class="text-xs font-extrabold ${active ? `bg-black ${textClass} border ${borderClass}` : `${textClass} ${bgClass} border ${borderClass}`} px-2.5 py-1 rounded-md tracking-wide">
                                         ${active ? '🟢 ИДЕТ СЕЙЧАС • ' : ''}№${lesson.number} &bull; ${lesson.time}
                                     </span>
                                     
                                     <div class="flex items-center gap-1.5 flex-wrap justify-end">
                                         ${lesson.subgroups && lesson.subgroups.length > 1 ? `
                                             <div class="flex flex-col gap-1.5 items-end">
                                                 ${lesson.subgroups.map((sub, sIdx) => `
                                                     <div class="flex items-center gap-1.5 flex-wrap justify-end">
                                                         <span class="text-[10px] font-extrabold uppercase ${bgClass} ${textClass} border ${borderClass} px-1.5 py-0.5 rounded">П${sIdx + 1}</span>
                                                         ${sub.teacher ? `<span class="text-xs font-semibold ${textClass} ${bgClass} px-2.5 py-0.5 rounded-md border ${borderClass}">👨‍🏫 ${sub.teacher}</span>` : ''}
                                                         ${sub.room ? `<button onclick="copyRoom('${sub.room}', event)" title="Кликните, чтобы скопировать кабинет" class="text-xs font-bold ${textClass} ${bgClass} px-2 py-0.5 rounded-lg border ${borderClass} shadow-none cursor-pointer whitespace-nowrap"><span>Каб: ${sub.room}</span> 📋</button>` : ''}
                                                     </div>
                                                 `).join('')}
                                             </div>
                                         ` : `
                                             ${lesson.teacher ? `
                                                 <span class="text-xs font-semibold ${textClass} ${bgClass} px-2.5 py-1 rounded-md border ${borderClass}">
                                                     👨‍🏫 ${lesson.teacher}
                                                 </span>
                                             ` : ''}
                                             ${lesson.room ? `
                                                 <button onclick="copyRoom('${lesson.room}', event)" title="Кликните, чтобы скопировать кабинет" class="text-xs font-bold ${textClass} ${bgClass} px-2.5 py-1 rounded-lg border ${borderClass} shadow-none cursor-pointer whitespace-nowrap">
                                                     <span>Каб: ${lesson.room}</span> 📋
                                                 </button>
                                             ` : ''}
                                         `}
                                    </div>
                                </div>

                                <div>
                                    <h4 class="font-extrabold text-base sm:text-lg ${textClass} tracking-tight leading-snug">${lesson.subject}</h4>
                                </div>
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
            <div class="col-span-full bg-white dark:bg-cardbg border border-slate-200 dark:border-slate-800 rounded-2xl p-12 text-center text-slate-700 dark:text-slate-300">
                <div class="text-3xl mb-2">🏖️</div>
                <p class="font-extrabold text-base">В этот день у группы ${currentGroup} нет занятий</p>
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
