/*
 * Settings drawer: presets, colours, typography, shape, background, sound,
 * import/export. All values live in NKSETheme (theme.js).
 */
(function () {
    'use strict';

    var T = window.NKSETheme;
    var panel = document.getElementById('settings-panel');
    var gear = document.getElementById('settings-btn');
    if (!T || !panel || !gear) return;

    var isOpen = false;
    var prevOverflow = '';
    var savedTimer = null;
    var closeTimer = null;
    var reduceMotion = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

    function esc(s) {
        return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }

    function $(sel) { return panel.querySelector(sel); }
    function $$(sel) { return Array.prototype.slice.call(panel.querySelectorAll(sel)); }

    function toHex(color) {
        if (!color) return '#000000';
        var c = String(color).trim();
        if (c.charAt(0) === '#') {
            if (c.length === 4) return '#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3];
            return c.slice(0, 7);
        }
        var m = c.match(/rgba?\(([^)]+)\)/);
        if (!m) return '#000000';
        var p = m[1].split(',').map(Number);
        return '#' + [p[0], p[1], p[2]].map(function (x) {
            var v = Math.max(0, Math.min(255, Math.round(x || 0))).toString(16);
            return v.length === 1 ? '0' + v : v;
        }).join('');
    }

    function validHex(v) { return /^#[0-9a-f]{6}$/i.test(String(v || '').trim()); }

    /* Маленькие иконки разделов: тот же штриховой стиль, что у кнопок шапки. */
    function ico(name) {
        var paths = {
            presets: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M18 15l.9 2.1L21 18l-2.1.9L18 21l-.9-2.1L15 18l2.1-.9z"/>',
            sound: '<path d="M4 9v6h4l5 4V5L8 9H4z"/><path d="M17 8.5a5 5 0 010 7"/><path d="M19.5 6a8.5 8.5 0 010 12"/>',
            colors: '<path d="M12 3s6 6.2 6 10a6 6 0 11-12 0c0-3.8 6-10 6-10z"/>',
            text: '<path d="M5 6h14"/><path d="M12 6v13"/><path d="M8 19h8"/>',
            shape: '<rect x="4" y="4" width="16" height="16" rx="4"/>',
            bg: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="8.5" cy="9" r="1.5"/><path d="M4 17l5-5 4 4 2-2 5 5"/>',
            behavior: '<path d="M4 7h10"/><circle cx="17" cy="7" r="3"/><path d="M4 17h4"/><circle cx="11" cy="17" r="3"/><path d="M14 17h6"/>',
            motion: '<path d="M3 12h3l2.5-6 3.5 12 2.5-6H21"/>',
            data: '<ellipse cx="12" cy="6" rx="7" ry="3"/><path d="M5 6v6c0 1.7 3.1 3 7 3s7-1.3 7-3V6"/><path d="M5 12v6c0 1.7 3.1 3 7 3s7-1.3 7-3v-6"/>'
        };
        return '<span class="settings-ico" aria-hidden="true"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round">' + (paths[name] || '') + '</svg></span>';
    }

    /* Настройки поведения живут отдельно от темы: их читает и сам сайт
       (app.js / motion.js), а не только движок оформления. */
    var PREF_SMOOTH = 'nkse-pref-smooth-wheel';
    var PREF_NOW = 'nkse-pref-now-bar';
    var PREF_NOW_ENDED = 'nkse-pref-now-ended';
    var PREF_PAST = 'nkse-pref-hide-past';

    function getPref(key, def) {
        try {
            var v = localStorage.getItem(key);
            return v === null ? def : v === '1';
        } catch (e) { return def; }
    }

    function setPref(key, val) {
        try { localStorage.setItem(key, val ? '1' : '0'); } catch (e) {}
        try { window.dispatchEvent(new CustomEvent('nkse-prefs-changed')); } catch (e) {}
    }

    function isImageUrlInput(u) {
        return /^(https?:\/\/|data:image\/|\.{0,2}\/|\/|[\w-]+\/)/i.test(u) ||
            /^[\w.-]+\.(png|jpe?g|webp|svg|gif)$/i.test(u);
    }

    function colorRows() {
        return T.getColors().map(function (pair) {
            return (
                '<div class="settings-color" data-color="' + pair[0] + '">' +
                '<input type="color" aria-label="' + esc(pair[1]) + '">' +
                '<span>' + esc(pair[1]) + '</span>' +
                '<input type="text" maxlength="7" spellcheck="false" aria-label="' + esc(pair[1]) + ', HEX">' +
                '</div>'
            );
        }).join('');
    }

    panel.innerHTML =
        '<div class="settings-scrim" data-close></div>' +
        '<aside class="settings-drawer" role="dialog" aria-modal="true" aria-labelledby="settings-title">' +
            '<header class="settings-head">' +
                '<div class="settings-head-text">' +
                    '<h2 id="settings-title">Настройки</h2>' +
                    '<p class="settings-sub" id="settings-sub">Тема: НКСЭ Тёмная</p>' +
                '</div>' +
                '<button type="button" id="settings-close" class="header-icon-btn" title="Закрыть" aria-label="Закрыть настройки">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
                '</button>' +
            '</header>' +
            '<nav class="settings-nav" id="settings-nav" aria-label="Разделы настроек">' +
                '<button type="button" class="settings-nav-chip" data-target="sec-presets">Темы</button>' +
                '<button type="button" class="settings-nav-chip" data-target="sec-sound">Звук</button>' +
                '<button type="button" class="settings-nav-chip" data-target="sec-colors">Цвета</button>' +
                '<button type="button" class="settings-nav-chip" data-target="sec-text">Текст</button>' +
                '<button type="button" class="settings-nav-chip" data-target="sec-shape">Форма</button>' +
                '<button type="button" class="settings-nav-chip" data-target="sec-motion">Анимации</button>' +
                '<button type="button" class="settings-nav-chip" data-target="sec-bg">Фон</button>' +
                '<button type="button" class="settings-nav-chip" data-target="sec-behavior">Поведение</button>' +
                '<button type="button" class="settings-nav-chip" data-target="sec-data">Данные</button>' +
            '</nav>' +
            '<div class="settings-body">' +
                '<div class="settings-preview" aria-hidden="true">' +
                    '<div class="lesson-card" style="border-left:3px solid var(--t-accent)">' +
                        '<div class="lesson-head">' +
                            '<span class="fs-badge lesson-num"><span class="num">№2</span><span class="num-time">09:40–11:00</span></span>' +
                            '<span class="fs-badge sub-flag">замена</span>' +
                        '</div>' +
                        '<h4 class="fs-subj font-extrabold tracking-tight leading-snug">Методы решения прикладных задач</h4>' +
                        '<div class="lesson-meta">' +
                            '<span class="fs-meta meta-item">Красноперова В И</span>' +
                            '<span class="room-btn fs-meta meta-item is-room">А418</span>' +
                        '</div>' +
                    '</div>' +
                '</div>' +

                '<section class="settings-group" id="sec-presets">' +
                    '<div class="settings-group-head"><h3>' + ico('presets') + 'Пресеты темы</h3></div>' +
                    '<div class="preset-grid" id="preset-grid"></div>' +
                    '<div class="settings-inline">' +
                        '<input id="preset-name" type="text" maxlength="40" placeholder="Название своего пресета">' +
                        '<button type="button" class="settings-btn is-primary" id="preset-save">Сохранить</button>' +
                    '</div>' +
                    '<div class="settings-buttons">' +
                        '<button type="button" class="settings-btn" id="preset-share">Поделиться кодом</button>' +
                        '<button type="button" class="settings-btn" id="preset-code-toggle">Вставить код</button>' +
                    '</div>' +
                    '<div id="preset-code-wrap" hidden>' +
                        '<textarea id="preset-code" class="settings-code" rows="3" spellcheck="false" placeholder="Вставь код пресета сюда..."></textarea>' +
                        '<div class="settings-buttons">' +
                            '<button type="button" class="settings-btn" id="preset-code-copy">Копировать</button>' +
                            '<button type="button" class="settings-btn is-primary" id="preset-code-add">Добавить пресет</button>' +
                        '</div>' +
                        '<div class="settings-hint" id="preset-code-hint">Код содержит цвета, форму, шрифт и ссылку на фон.</div>' +
                    '</div>' +
                    '<div class="settings-hint">«НКСЭ Тёмная» и «НКСЭ Светлая» — основные темы в стиле сайта. Старые тёмная и светлая помечены «(старая)». Остальные темы — дополнительные. Кнопка темы в шапке переключает основные.</div>' +
                '</section>' +

                '<section class="settings-group" id="sec-sound">' +
                    '<div class="settings-group-head"><h3>' + ico('sound') + 'Звуки</h3></div>' +
                    '<label class="settings-toggle"><span>Включить звуки</span><input type="checkbox" id="sound-enabled"></label>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Громкость</span><output class="settings-value" id="sound-volume-value">55%</output></div>' +
                        '<input type="range" id="sound-volume" min="0" max="1000" step="5">' +
                    '</div>' +
                    '<label class="settings-toggle"><span>Разрешить до 1000%</span><input type="checkbox" id="sound-loud"></label>' +
                    '<div class="settings-hint">По умолчанию до 100%. 1000% — только если включить выше, это очень громко.</div>' +
                    '<div class="settings-row"><span>Набор</span>' +
                        '<select id="sound-pack">' +
                            '<option value="soft">Мягкие</option>' +
                            '<option value="click">Короткие клики</option>' +
                            '<option value="retro">Ретро</option>' +
                            '<option value="bell">Колокольчик</option>' +
                            '<option value="wood">Дерево</option>' +
                            '<option value="digital">Цифровые</option>' +
                            '<option value="custom">Свой звук</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="settings-subhead">Проверить звук</div>' +
                    '<div class="settings-buttons settings-sound-preview">' +
                        '<button type="button" class="settings-btn" data-preview-sound="tap">Клик</button>' +
                        '<button type="button" class="settings-btn" data-preview-sound="switch">Переключение</button>' +
                        '<button type="button" class="settings-btn" data-preview-sound="success">Успех</button>' +
                        '<button type="button" class="settings-btn" data-preview-sound="error">Ошибка</button>' +
                    '</div>' +
                    '<div class="settings-hint">Эти кнопки проигрывают выбранный набор — даже если звуки выключены.</div>' +
                    '<div id="sound-custom-row" hidden>' +
                        '<div class="settings-inline">' +
                            '<input id="sound-file" type="file" accept="audio/*" hidden>' +
                            '<button type="button" class="settings-btn" id="sound-upload">Загрузить свой звук…</button>' +
                            '<span class="settings-hint" id="sound-custom-name">не выбран</span>' +
                        '</div>' +
                        '<div class="settings-hint">Короткий mp3/wav/ogg до ~600 КБ. Играет вместо набора, когда выбран «Свой звук».</div>' +
                    '</div>' +
                    '<div class="settings-hint">По умолчанию звуки выключены. Настройка хранится только на этом устройстве.</div>' +
                '</section>' +

                '<section class="settings-group" id="sec-colors">' +
                    '<div class="settings-group-head"><h3>' + ico('colors') + 'Цвета</h3><button type="button" class="settings-reset" data-reset="colors">Сброс</button></div>' +
                    '<div class="settings-color-list" id="color-list">' + colorRows() + '</div>' +
                '</section>' +

                '<section class="settings-group" id="sec-text">' +
                    '<div class="settings-group-head"><h3>' + ico('text') + 'Текст</h3><button type="button" class="settings-reset" data-reset="text">Сброс</button></div>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Размер текста</span><output class="settings-value" id="text-scale-value">100%</output></div>' +
                        '<input type="range" id="text-scale" min="85" max="130" step="1">' +
                    '</div>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Межстрочный интервал</span><output class="settings-value" id="line-height-value">1.42</output></div>' +
                        '<input type="range" id="line-height" min="1.2" max="1.8" step="0.01">' +
                    '</div>' +
                    '<div class="settings-row"><span>Шрифт заголовков</span>' +
                        '<select id="display-font">' +
                            '<option value="sans">Системный</option>' +
                            '<option value="humanist">Segoe UI</option>' +
                            '<option value="serif">С засечками</option>' +
                            '<option value="display">Palatino</option>' +
                            '<option value="rounded">Trebuchet</option>' +
                            '<option value="candara">Candara</option>' +
                            '<option value="condensed">Узкий</option>' +
                            '<option value="mono">Моно</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="settings-hint">Все шрифты системные — ничего не скачивается и не замедляет загрузку.</div>' +
                '</section>' +

                '<section class="settings-group" id="sec-shape">' +
                    '<div class="settings-group-head"><h3>' + ico('shape') + 'Форма и отступы</h3><button type="button" class="settings-reset" data-reset="shape">Сброс</button></div>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Скругление</span><output class="settings-value" id="radius-value">18 px</output></div>' +
                        '<input type="range" id="radius" min="0" max="32" step="1">' +
                    '</div>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Плотность</span><output class="settings-value" id="space-scale-value">100%</output></div>' +
                        '<input type="range" id="space-scale" min="70" max="150" step="1">' +
                    '</div>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Толщина границ</span><output class="settings-value" id="border-width-value">1 px</output></div>' +
                        '<input type="range" id="border-width" min="0" max="3" step="0.5">' +
                    '</div>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Прозрачность карточек</span><output class="settings-value" id="card-opacity-value">100%</output></div>' +
                        '<input type="range" id="card-opacity" min="50" max="100" step="1">' +
                    '</div>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Свечение</span><output class="settings-value" id="glow-value">0 px</output></div>' +
                        '<input type="range" id="glow" min="0" max="30" step="1">' +
                    '</div>' +
                '</section>' +

                '<section class="settings-group" id="sec-motion">' +
                    '<div class="settings-group-head"><h3>' + ico('motion') + 'Анимации</h3><button type="button" class="settings-reset" data-reset="motion">Сброс</button></div>' +
                    '<label class="settings-toggle"><span>Включить анимации</span><input type="checkbox" id="motion"></label>' +
                    '<div class="settings-row"><span>Стиль переключения дней</span>' +
                        '<select id="anim-style">' +
                            '<option value="auto">Как в теме</option>' +
                            '<option value="gold">Золотая капсула</option>' +
                            '<option value="glow">Свечение</option>' +
                            '<option value="soft">Мягкое</option>' +
                            '<option value="none">Без</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="settings-row"><span>Скорость</span>' +
                        '<select id="anim-speed">' +
                            '<option value="1.3">Медленно</option>' +
                            '<option value="1">Обычно</option>' +
                            '<option value="0.75">Быстро</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="settings-hint">По умолчанию стиль задаёт тема. Здесь можно переопределить, замедлить или выключить.</div>' +
                '</section>' +

                '<section class="settings-group" id="sec-bg">' +
                    '<div class="settings-group-head"><h3>' + ico('bg') + 'Фон</h3><button type="button" class="settings-reset" data-reset="background">Сброс</button></div>' +
                    '<div class="settings-row"><span>Тип фона</span>' +
                        '<select id="bg-type">' +
                            '<option value="none">Нет</option>' +
                            '<option value="color">Цвет</option>' +
                            '<option value="gradient">Градиент</option>' +
                            '<option value="image">Картинка</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="settings-row" id="bg-color-row"><span>Цвет фона</span><input type="color" id="bg-color"></div>' +
                    '<div id="bg-gradient-rows">' +
                        '<div class="settings-row"><span>С</span><input type="color" id="bg-from"></div>' +
                        '<div class="settings-row"><span>По</span><input type="color" id="bg-to"></div>' +
                        '<div class="settings-slider">' +
                            '<div class="settings-row"><span>Угол</span><output class="settings-value" id="bg-angle-value">135°</output></div>' +
                            '<input type="range" id="bg-angle" min="0" max="360" step="1">' +
                        '</div>' +
                    '</div>' +
                    '<div id="bg-image-rows">' +
                        '<div class="settings-inline">' +
                            '<input id="bg-url" type="url" placeholder="https://..." spellcheck="false">' +
                            '<button type="button" class="settings-btn" id="bg-apply-url">Применить</button>' +
                        '</div>' +
                        '<div class="settings-inline">' +
                            '<input id="bg-mobile-url" type="url" placeholder="Мобильный фон (ссылка)" spellcheck="false">' +
                            '<button type="button" class="settings-btn" id="bg-apply-mobile">Применить</button>' +
                        '</div>' +
                        '<div class="settings-hint">Если мобильный фон пуст, на телефоне используется основной.</div>' +
                        '<div class="settings-inline">' +
                            '<input id="bg-file" type="file" accept="image/*" hidden>' +
                            '<button type="button" class="settings-btn" id="bg-upload">Загрузить фото</button>' +
                            '<span class="settings-hint" id="bg-status"></span>' +
                        '</div>' +
                        '<div class="settings-row"><span>Вписать</span>' +
                            '<select id="bg-fit">' +
                                '<option value="cover">Заполнить</option>' +
                                '<option value="contain">Вместить</option>' +
                                '<option value="repeat">Плиткой</option>' +
                            '</select>' +
                        '</div>' +
                        '<div class="settings-row"><span>Позиция</span>' +
                            '<select id="bg-position">' +
                                '<option value="center">Центр</option>' +
                                '<option value="top">Сверху</option>' +
                                '<option value="bottom">Снизу</option>' +
                                '<option value="left">Слева</option>' +
                                '<option value="right">Справа</option>' +
                            '</select>' +
                        '</div>' +
                        '<div class="settings-slider">' +
                            '<div class="settings-row"><span>Затемнение</span><output class="settings-value" id="bg-dim-value">35%</output></div>' +
                            '<input type="range" id="bg-dim" min="0" max="90" step="1">' +
                        '</div>' +
                        '<div class="settings-bg-preview" aria-hidden="true"></div>' +
                    '</div>' +
                '</section>' +

                '<section class="settings-group" id="sec-behavior">' +
                    '<div class="settings-group-head"><h3>' + ico('behavior') + 'Поведение</h3><button type="button" class="settings-reset" data-reset="behavior">Сброс</button></div>' +
                    '<label class="settings-toggle"><span>Плавная прокрутка колесом</span><input type="checkbox" id="pref-smooth-wheel"></label>' +
                    '<div class="settings-hint">Для компьютера: колесо мыши догоняет плавно, на телефоне прокрутка остаётся обычной.</div>' +
                    '<label class="settings-toggle"><span>Показывать «сейчас идёт»</span><input type="checkbox" id="pref-now-bar"></label>' +
                    '<label class="settings-toggle"><span>Показывать «пары закончились»</span><input type="checkbox" id="pref-now-ended"></label>' +
                    '<label class="settings-toggle"><span>Скрывать прошедшие пары сегодня</span><input type="checkbox" id="pref-hide-past"></label>' +
                    '<div class="settings-row"><span>Положение панели</span>' +
                        '<select id="nav-pos">' +
                            '<option value="top">Сверху</option>' +
                            '<option value="left">Слева</option>' +
                            '<option value="right">Справа</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="settings-hint">Слева/справа — вертикальная панель на компьютере; на телефоне остаётся сверху.</div>' +
                '</section>' +

                '<section class="settings-group" id="sec-data">' +
                    '<div class="settings-group-head"><h3>' + ico('data') + 'Данные</h3></div>' +
                    '<div class="settings-buttons">' +
                        '<button type="button" class="settings-btn" id="export-theme">Экспорт</button>' +
                        '<button type="button" class="settings-btn" id="import-theme">Импорт</button>' +
                        '<input id="import-file" type="file" accept="application/json,.json" hidden>' +
                        '<button type="button" class="settings-btn is-danger" id="reset-all">Сбросить всё</button>' +
                    '</div>' +
                    '<div class="settings-hint">Тема, пресеты и звук хранятся только на этом устройстве.</div>' +
                '</section>' +
            '</div>' +
            '<footer class="settings-foot">' +
                '<span class="settings-saved" id="settings-saved">Сохранено</span>' +
                '<button type="button" class="settings-btn is-primary" id="settings-done">Готово</button>' +
            '</footer>' +
        '</aside>';

    /* ---------------- sync ---------------- */

    function setRange(id, value, format) {
        var el = $('#' + id);
        if (el) el.value = value;
        var out = $('#' + id + '-value');
        if (out) out.textContent = format ? format(value) : value;
    }

    function sync() {
        var s = T.getState();

        var presetName = 'Своя тема';
        T.getPresets().forEach(function (p) {
            if (p.id === s.preset) presetName = p.name;
        });
        var sub = $('#settings-sub');
        if (sub) sub.textContent = 'Тема: ' + presetName;

        $('#sound-enabled').checked = !!s.sound.enabled;
        var loud = !!s.sound.allowLoud;
        var volEl = $('#sound-volume');
        if (volEl) volEl.max = loud ? '1000' : '100';
        setRange('sound-volume', Math.min(s.sound.volume, loud ? 1000 : 100), function (v) { return Math.round(v) + '%'; });
        $('#sound-loud').checked = loud;
        $('#sound-pack').value = s.sound.pack;
        $('#sound-custom-row').hidden = s.sound.pack !== 'custom';
        var customName = $('#sound-custom-name');
        if (customName) customName.textContent = s.sound.customName ? s.sound.customName : 'не выбран';

        $$('.settings-color').forEach(function (row) {
            var key = row.dataset.color;
            var hex = toHex(s.tokens[key]);
            row.querySelector('input[type="color"]').value = hex;
            row.querySelector('input[type="text"]').value = hex;
        });

        setRange('text-scale', Math.round(s.metrics.textScale * 100), function (v) { return Math.round(v) + '%'; });
        setRange('line-height', s.metrics.lineHeight, function (v) { return Number(v).toFixed(2); });
        setRange('radius', s.metrics.radius, function (v) { return Math.round(v) + ' px'; });
        setRange('space-scale', Math.round(s.metrics.spaceScale * 100), function (v) { return Math.round(v) + '%'; });
        setRange('border-width', s.metrics.border, function (v) { return Number(v) + ' px'; });
        setRange('card-opacity', Math.round(s.metrics.cardOpacity * 100), function (v) { return Math.round(v) + '%'; });
        setRange('glow', s.metrics.glow, function (v) { return Math.round(v) + ' px'; });
        $('#display-font').value = s.metrics.displayFont || 'sans';
        $('#motion').checked = !!s.metrics.motion;
        $('#anim-style').value = s.metrics.animStyle || 'auto';
        $('#anim-speed').value = String(s.metrics.animSpeed || 1);

        $('#pref-smooth-wheel').checked = getPref(PREF_SMOOTH, true);
        $('#pref-now-bar').checked = getPref(PREF_NOW, true);
        $('#pref-now-ended').checked = getPref(PREF_NOW_ENDED, false);
        $('#pref-hide-past').checked = getPref(PREF_PAST, false);
        $('#nav-pos').value = s.metrics.navPos || 'top';

        var bg = s.background;
        $('#bg-type').value = bg.type || 'none';
        $('#bg-color').value = toHex(bg.color || s.tokens.bg);
        $('#bg-from').value = toHex(bg.from || '#111827');
        $('#bg-to').value = toHex(bg.to || '#000000');
        setRange('bg-angle', Math.round(bg.angle || 135), function (v) { return Math.round(v) + '°'; });
        $('#bg-url').value = bg.url || '';
        $('#bg-url').placeholder = bg.imageId && !bg.url ? 'Картинка загружена с устройства' : 'https://...';
        $('#bg-mobile-url').value = bg.mobileUrl || '';
        $('#bg-fit').value = bg.fit || 'cover';
        $('#bg-position').value = bg.position || 'center';
        setRange('bg-dim', Math.round((bg.dim || 0) * 100), function (v) { return Math.round(v) + '%'; });
        $('#bg-status').textContent = bg.imageId ? 'Фото сохранено на устройстве' : '';

        var showColor = bg.type === 'color';
        var showGradient = bg.type === 'gradient';
        var showImage = bg.type === 'image';
        $('#bg-color-row').hidden = !showColor;
        $('#bg-gradient-rows').hidden = !showGradient;
        $('#bg-image-rows').hidden = !showImage;

        updatePresetActive();
    }

    function renderPresets() {
        var s = T.getState();
        $('#preset-grid').innerHTML = T.getPresets().map(function (p) {
            var c = T.getPresetColors(p.id);
            var style =
                '--p-bg:' + esc(c.bg) +
                ';--p-surface:' + esc(c.surface) +
                ';--p-accent:' + esc(c.accent) +
                ';--p-text:' + esc(c.text) +
                ';--p-border:' + esc(c.border || c.surface);
            if (c.image) {
                style += ';background-image:url(&quot;' + esc(c.image) + '&quot;);background-size:cover;background-position:center';
            }
            return (
                '<button type="button" class="preset-card' + (s.preset === p.id ? ' is-active' : '') + '" data-preset="' + esc(p.id) + '">' +
                    '<span class="preset-preview' + (c.image ? ' has-photo' : '') + '" style="' + style + '">' +
                        '<span class="pp-accent"></span>' +
                        '<span class="pp-card">' +
                            '<span class="pp-line pp-time"></span>' +
                            '<span class="pp-line pp-subject"></span>' +
                            '<span class="pp-line is-short"></span>' +
                            '<span class="pp-pill"></span>' +
                        '</span>' +
                    '</span>' +
                    '<span class="preset-foot">' +
                        '<span class="preset-name">' + esc(p.name) + '</span>' +
                        '<span class="preset-share" data-share="' + esc(p.id) + '" title="Поделиться кодом">↗</span>' +
                        (p.builtin ? '' : '<span class="preset-del" data-del="' + esc(p.id) + '" title="Удалить">×</span>') +
                    '</span>' +
                '</button>'
            );
        }).join('');
    }

    function updatePresetActive() {
        var preset = T.getState().preset;
        $$('.preset-card').forEach(function (card) {
            card.classList.toggle('is-active', card.dataset.preset === preset);
        });
    }

    function copyText(text) {
        try {
            if (navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(text).catch(function () {});
                return;
            }
        } catch (e) {}
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.opacity = '0';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch (e) {}
        document.body.removeChild(ta);
    }

    function showPresetCode(res) {
        var wrap = $('#preset-code-wrap');
        var ta = $('#preset-code');
        wrap.hidden = false;
        ta.value = res.code;
        ta.scrollTop = 0;
        $('#preset-code-hint').textContent =
            res.warning ||
            'Код содержит цвета, форму, шрифт и ссылку на фон. Отправь его другу — он вставит код в настройках.';
        copyText(res.code);
        status('Код пресета скопирован');
    }

    function sharePreset(id) {
        T.exportPresetCode(id)
            .then(function (res) {
                showPresetCode(res);
                T.play('success');
            })
            .catch(function (err) {
                status('Не удалось получить код: ' + (err && err.message ? err.message : 'ошибка'));
            });
    }

    function status(text) {
        var el = $('#settings-saved');
        if (el) el.textContent = text;
    }

    function showSaved() {
        if (savedTimer) clearTimeout(savedTimer);
        status('Сохранено');
        savedTimer = setTimeout(function () { savedTimer = null; }, 1200);
    }

    /* ---------------- разделы (быстрый переход) ---------------- */

    var nav = $('#settings-nav');
    var bodyEl = $('.settings-body');
    var navRaf = 0;
    /* После клика по вкладке не даём scroll-spy перебить выбранный раздел,
       пока плавная прокрутка не закончится. */
    var navLockUntil = 0;

    function navChips() { return $$('.settings-nav-chip'); }

    function ensureChipVisible(chip) {
        if (!nav) return;
        var left = chip.offsetLeft;
        var right = left + chip.offsetWidth;
        if (left < nav.scrollLeft + 4) {
            nav.scrollTo({ left: Math.max(0, left - 12), behavior: reduceMotion ? 'auto' : 'smooth' });
        } else if (right > nav.scrollLeft + nav.clientWidth - 4) {
            nav.scrollTo({ left: right - nav.clientWidth + 12, behavior: reduceMotion ? 'auto' : 'smooth' });
        }
    }

    function updateNavActive() {
        if (!nav || !bodyEl) return;
        var chips = navChips();
        if (!chips.length) return;
        var bodyTop = bodyEl.getBoundingClientRect().top;
        var atBottom = bodyEl.scrollTop + bodyEl.clientHeight >= bodyEl.scrollHeight - 2;
        var activeId = '';
        if (!atBottom) {
            chips.forEach(function (chip) {
                var sec = document.getElementById(chip.dataset.target);
                if (sec && sec.getBoundingClientRect().top - bodyTop <= 40) activeId = chip.dataset.target;
            });
        }
        // В самом низу раздел уже не поднять к верху — подсвечиваем первый
        // видимый, иначе клик по «Поведению» оставлял бы «Фон».
        if (!activeId) {
            for (var i = 0; i < chips.length; i += 1) {
                var s = document.getElementById(chips[i].dataset.target);
                if (s && s.getBoundingClientRect().top - bodyTop >= -8) {
                    activeId = chips[i].dataset.target;
                    break;
                }
            }
        }
        if (!activeId) activeId = chips[0].dataset.target;
        chips.forEach(function (chip) {
            var on = chip.dataset.target === activeId;
            chip.classList.toggle('is-active', on);
            chip.setAttribute('aria-current', on ? 'true' : 'false');
            if (on) ensureChipVisible(chip);
        });
    }

    function scrollToSection(id) {
        if (!bodyEl) return;
        var target = document.getElementById(id);
        if (!target) return;
        var top = bodyEl.scrollTop + target.getBoundingClientRect().top - bodyEl.getBoundingClientRect().top - 8;
        bodyEl.scrollTo({ top: Math.max(0, top), behavior: reduceMotion ? 'auto' : 'smooth' });
    }

    if (nav) {
        nav.addEventListener('click', function (e) {
            var chip = e.target.closest('.settings-nav-chip');
            if (!chip) return;
            navChips().forEach(function (c) {
                var on = c === chip;
                c.classList.toggle('is-active', on);
                c.setAttribute('aria-current', on ? 'true' : 'false');
            });
            navLockUntil = performance.now() + 900;
            scrollToSection(chip.dataset.target);
        });
    }

    if (bodyEl) {
        bodyEl.addEventListener('scroll', function () {
            if (navRaf) return;
            navRaf = requestAnimationFrame(function () {
                navRaf = 0;
                if (nav) nav.classList.toggle('is-stuck', bodyEl.scrollTop > 4);
                if (performance.now() >= navLockUntil) updateNavActive();
            });
        }, { passive: true });
    }

    /* ---------------- open / close ---------------- */

    function open() {
        if (isOpen) return;
        isOpen = true;
        if (closeTimer) { clearTimeout(closeTimer); closeTimer = null; }
        prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panel.hidden = false;
        // сначала кадр в закрытом положении, затем класс is-open — так
        // срабатывает CSS-переход, а не мгновенное появление
        panel.classList.remove('is-open');
        void panel.offsetWidth;
        requestAnimationFrame(function () { panel.classList.add('is-open'); });
        gear.setAttribute('aria-expanded', 'true');
        sync();
        status('Сохранено');
        try { T.play('open'); } catch (e) {}
        setTimeout(function () { var b = $('#settings-close'); if (b) b.focus(); }, 0);
        updateNavActive();
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        panel.classList.remove('is-open');
        gear.setAttribute('aria-expanded', 'false');
        document.body.style.overflow = prevOverflow;
        try { T.play('close'); } catch (e) {}
        gear.focus();
        var finish = function () {
            if (!isOpen) panel.hidden = true;
        };
        if (reduceMotion) finish();
        else closeTimer = setTimeout(function () { closeTimer = null; finish(); }, 300);
    }

    gear.addEventListener('click', function () {
        if (isOpen) close();
        else open();
    });
    $('#settings-close').addEventListener('click', close);
    $('#settings-done').addEventListener('click', close);
    $('.settings-scrim').addEventListener('click', close);
    panel.addEventListener('click', function (e) {
        if (e.target === panel) close();
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape' && isOpen) close();
    });

    panel.addEventListener('keydown', function (e) {
        if (e.key !== 'Tab') return;
        var items = $$('button, input, select, textarea, a[href]').filter(function (el) {
            return !el.disabled && el.offsetParent !== null;
        });
        if (!items.length) return;
        var first = items[0];
        var last = items[items.length - 1];
        if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
        }
    });

    /* ---------------- presets ---------------- */

    $('#preset-grid').addEventListener('click', function (e) {
        var share = e.target.closest('[data-share]');
        if (share) {
            e.preventDefault();
            e.stopPropagation();
            sharePreset(share.dataset.share);
            return;
        }
        var del = e.target.closest('[data-del]');
        if (del) {
            e.preventDefault();
            e.stopPropagation();
            var id = del.dataset.del;
            if (confirm('Удалить этот пресет?')) {
                T.deletePreset(id);
                renderPresets();
                sync();
            }
            return;
        }
        var card = e.target.closest('[data-preset]');
        if (!card) return;
        if (T.applyPreset(card.dataset.preset)) {
            T.play('switch');
            renderPresets();
            sync();
        }
    });

    $('#preset-save').addEventListener('click', function () {
        var input = $('#preset-name');
        var name = (input.value || '').trim() || 'Мой пресет';
        var id = T.savePreset(name);
        if (id) {
            T.play('success');
            input.value = '';
            renderPresets();
            sync();
        }
    });

    $('#preset-name').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('#preset-save').click();
        }
    });

    $('#preset-share').addEventListener('click', function () {
        sharePreset(T.getState().preset || 'custom');
    });

    $('#preset-code-toggle').addEventListener('click', function () {
        var wrap = $('#preset-code-wrap');
        var ta = $('#preset-code');
        wrap.hidden = false;
        ta.value = '';
        $('#preset-code-hint').textContent = 'Вставь код пресета и нажми «Добавить пресет».';
        ta.focus();
    });

    $('#preset-code-copy').addEventListener('click', function () {
        var code = $('#preset-code').value;
        if (!code) return;
        copyText(code);
        status('Код скопирован');
        T.play('success');
    });

    $('#preset-code-add').addEventListener('click', function () {
        var code = $('#preset-code').value.trim();
        if (!code) {
            status('Вставь код пресета');
            return;
        }
        T.importPresetCode(code)
            .then(function (res) {
                T.play('success');
                renderPresets();
                sync();
                status('Пресет «' + res.name + '» добавлен');
                $('#preset-code-hint').textContent = 'Пресет добавлен и применён.';
            })
            .catch(function (err) {
                T.play('error');
                status('Код не подошёл: ' + (err && err.message ? err.message : 'ошибка'));
            });
    });

    /* ---------------- sound ---------------- */

    $('#sound-enabled').addEventListener('change', function (e) {
        T.setSound({ enabled: e.target.checked });
        if (e.target.checked) T.previewSound('tap');
    });

    $('#sound-volume').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#sound-volume-value').textContent = v + '%';
        T.setSound({ volume: v });
    });
    $('#sound-volume').addEventListener('change', function () {
        T.previewSound('switch');
    });

    $('#sound-pack').addEventListener('change', function (e) {
        T.setSound({ pack: e.target.value });
        T.previewSound('tap', e.target.value);
        if (e.target.value === 'custom' && !T.hasCustomSound()) {
            status('Сначала загрузите свой звук');
        }
        sync();
    });

    $('#sound-loud').addEventListener('change', function (e) {
        var loud = e.target.checked;
        T.setSound({ allowLoud: loud });
        if (!loud && T.getState().sound.volume > 100) T.setSound({ volume: 100 });
        sync();
    });

    $('#sound-upload').addEventListener('click', function () {
        $('#sound-file').click();
    });

    $('#sound-file').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        if (!/^audio\//.test(file.type)) {
            status('Нужен аудиофайл (mp3, wav, ogg)');
            return;
        }
        if (file.size > 620000) {
            status('Файл больше ~600 КБ — возьмите короткий звук');
            return;
        }
        var reader = new FileReader();
        reader.onerror = function () { status('Не удалось прочитать файл'); };
        reader.onload = function () {
            T.setCustomSound(reader.result, file.name)
                .then(function () {
                    status('Свой звук загружен');
                    sync();
                    T.previewSound('success', 'custom');
                })
                .catch(function (err) {
                    status('Не получилось: ' + (err && err.message ? err.message : 'ошибка'));
                });
        };
        reader.readAsDataURL(file);
    });

    $$('[data-preview-sound]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            T.previewSound(btn.dataset.previewSound, $('#sound-pack').value);
        });
    });

    /* ---------------- colors ---------------- */

    $('#color-list').addEventListener('input', function (e) {
        if (e.target.matches('input[type="color"]')) {
            var row = e.target.closest('[data-color]');
            if (row) T.setColor(row.dataset.color, e.target.value);
        }
    });
    $('#color-list').addEventListener('change', function (e) {
        if (!e.target.matches('input[type="text"]')) return;
        var row = e.target.closest('[data-color]');
        if (!row) return;
        if (validHex(e.target.value)) T.setColor(row.dataset.color, e.target.value.trim());
        else sync();
    });

    /* ---------------- metrics ---------------- */

    $('#text-scale').addEventListener('input', function (e) {
        var v = Number(e.target.value) / 100;
        $('#text-scale-value').textContent = Math.round(Number(e.target.value)) + '%';
        T.setMetric('textScale', v);
    });
    $('#line-height').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#line-height-value').textContent = v.toFixed(2);
        T.setMetric('lineHeight', v);
    });
    $('#radius').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#radius-value').textContent = v + ' px';
        T.setMetric('radius', v);
    });
    $('#space-scale').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#space-scale-value').textContent = v + '%';
        T.setMetric('spaceScale', v / 100);
    });
    $('#border-width').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#border-width-value').textContent = v + ' px';
        T.setMetric('border', v);
    });
    $('#card-opacity').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#card-opacity-value').textContent = v + '%';
        T.setMetric('cardOpacity', v / 100);
    });
    $('#glow').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#glow-value').textContent = v + ' px';
        T.setMetric('glow', v);
    });
    $('#display-font').addEventListener('change', function (e) {
        T.setMetric('displayFont', e.target.value);
    });
    $('#motion').addEventListener('change', function (e) {
        T.setMetric('motion', e.target.checked);
    });

    $('#anim-style').addEventListener('change', function (e) {
        T.setMetric('animStyle', e.target.value);
        T.play('switch');
    });

    $('#anim-speed').addEventListener('change', function (e) {
        T.setMetric('animSpeed', parseFloat(e.target.value) || 1);
        T.play('switch');
    });

    /* ---------------- поведение ---------------- */

    $('#pref-smooth-wheel').addEventListener('change', function (e) {
        setPref(PREF_SMOOTH, e.target.checked);
        if (window.NKSEScroll) window.NKSEScroll.setEnabled(e.target.checked);
        showSaved();
    });

    $('#pref-now-bar').addEventListener('change', function (e) {
        setPref(PREF_NOW, e.target.checked);
        showSaved();
    });

    $('#pref-now-ended').addEventListener('change', function (e) {
        setPref(PREF_NOW_ENDED, e.target.checked);
        showSaved();
    });

    $('#pref-hide-past').addEventListener('change', function (e) {
        setPref(PREF_PAST, e.target.checked);
        showSaved();
    });

    $('#nav-pos').addEventListener('change', function (e) {
        T.setMetric('navPos', e.target.value);
        showSaved();
    });

    /* ---------------- background ---------------- */

    $('#bg-type').addEventListener('change', function (e) {
        T.setBackground({ type: e.target.value });
        sync();
    });

    $('#bg-color').addEventListener('input', function (e) {
        T.setBackground({ type: 'color', color: e.target.value });
        T.setColor('bg', e.target.value);
    });

    $('#bg-from').addEventListener('input', function (e) {
        T.setBackground({ type: 'gradient', from: e.target.value });
    });
    $('#bg-to').addEventListener('input', function (e) {
        T.setBackground({ type: 'gradient', to: e.target.value });
    });
    $('#bg-angle').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#bg-angle-value').textContent = v + '°';
        T.setBackground({ type: 'gradient', angle: v });
    });

    $('#bg-apply-url').addEventListener('click', function () {
        var url = ($('#bg-url').value || '').trim();
        if (!url) return;
        if (!isImageUrlInput(url)) {
            status('Нужна ссылка http(s), путь к картинке или data:image');
            return;
        }
        T.setBackground({ type: 'image', url: url, imageId: '' });
        sync();
    });

    $('#bg-apply-mobile').addEventListener('click', function () {
        var url = ($('#bg-mobile-url').value || '').trim();
        if (url && !isImageUrlInput(url)) {
            status('Нужна ссылка http(s) или путь к картинке');
            return;
        }
        T.setBackground({ type: url ? 'image' : T.getState().background.type, mobileUrl: url });
        sync();
    });

    $('#bg-url').addEventListener('keydown', function (e) {
        if (e.key === 'Enter') {
            e.preventDefault();
            $('#bg-apply-url').click();
        }
    });

    $('#bg-upload').addEventListener('click', function () {
        $('#bg-file').click();
    });

    $('#bg-file').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        status('Сжимаю картинку…');
        T.processImageFile(file)
            .then(function (dataUrl) {
                return T.setBackgroundImage(dataUrl);
            })
            .then(function () {
                status('Фото сохранено');
                sync();
            })
            .catch(function (err) {
                status('Не удалось загрузить: ' + (err && err.message ? err.message : 'ошибка'));
            });
    });

    $('#bg-fit').addEventListener('change', function (e) {
        T.setBackground({ fit: e.target.value });
    });
    $('#bg-position').addEventListener('change', function (e) {
        T.setBackground({ position: e.target.value });
    });
    $('#bg-dim').addEventListener('input', function (e) {
        var v = Number(e.target.value);
        $('#bg-dim-value').textContent = v + '%';
        T.setBackground({ dim: v / 100 });
    });

    /* ---------------- data ---------------- */

    $('#export-theme').addEventListener('click', function () {
        var text = T.exportState();
        var blob = new Blob([text], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'nkse-theme.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
        status('Файл сохранён');
    });

    $('#import-theme').addEventListener('click', function () {
        $('#import-file').click();
    });

    $('#import-file').addEventListener('change', function (e) {
        var file = e.target.files && e.target.files[0];
        e.target.value = '';
        if (!file) return;
        file.text()
            .then(function (text) { return T.importState(text); })
            .then(function () {
                renderPresets();
                sync();
                status('Импортировано');
            })
            .catch(function (err) {
                status('Не удалось импортировать: ' + (err && err.message ? err.message : 'ошибка'));
            });
    });

    $('#reset-all').addEventListener('click', function () {
        if (!confirm('Сбросить настройки темы, фона и звука?')) return;
        T.resetAll();
        T.play('close');
        renderPresets();
        sync();
        status('Сброшено');
    });

    $$('[data-reset]').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var what = btn.dataset.reset;
            if (what === 'colors') T.resetColors();
            else if (what === 'text') {
                T.setMetric('textScale', 1);
                T.setMetric('lineHeight', 1.42);
                T.setMetric('displayFont', 'sans');
            } else if (what === 'shape') {
                T.setMetric('radius', 18);
                T.setMetric('spaceScale', 1);
                T.setMetric('border', 1);
                T.setMetric('cardOpacity', 1);
                T.setMetric('glow', 0);
                T.setMetric('motion', true);
            } else if (what === 'background') {
                T.resetBackground();
            } else if (what === 'motion') {
                T.setMetric('motion', true);
                T.setMetric('animStyle', 'auto');
                T.setMetric('animSpeed', 1);
            } else if (what === 'behavior') {
                setPref(PREF_SMOOTH, true);
                setPref(PREF_NOW, true);
                setPref(PREF_NOW_ENDED, false);
                setPref(PREF_PAST, false);
                T.setMetric('navPos', 'top');
                if (window.NKSEScroll) window.NKSEScroll.setEnabled(true);
            }
            renderPresets();
            sync();
        });
    });

    /* ---------------- engine events ---------------- */

    document.addEventListener('nkse-theme-change', function () {
        status('Сохранение…');
        sync();
    });
    document.addEventListener('nkse-theme-saved', function () {
        showSaved();
    });

    renderPresets();
    sync();
    updateNavActive();
})();
