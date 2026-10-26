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
                '<h2 id="settings-title">Настройки</h2>' +
                '<button type="button" id="settings-close" class="header-icon-btn" title="Закрыть" aria-label="Закрыть настройки">' +
                    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>' +
                '</button>' +
            '</header>' +
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

                '<section class="settings-group">' +
                    '<div class="settings-group-head"><h3>Пресеты темы</h3></div>' +
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

                '<section class="settings-group">' +
                    '<div class="settings-group-head"><h3>Звуки</h3></div>' +
                    '<label class="settings-toggle"><span>Включить звуки</span><input type="checkbox" id="sound-enabled"></label>' +
                    '<div class="settings-slider">' +
                        '<div class="settings-row"><span>Громкость</span><output class="settings-value" id="sound-volume-value">55%</output></div>' +
                        '<input type="range" id="sound-volume" min="0" max="100" step="1">' +
                    '</div>' +
                    '<div class="settings-row"><span>Набор</span>' +
                        '<select id="sound-pack">' +
                            '<option value="soft">Мягкие</option>' +
                            '<option value="click">Короткие клики</option>' +
                            '<option value="retro">Ретро</option>' +
                        '</select>' +
                    '</div>' +
                    '<div class="settings-buttons">' +
                        '<button type="button" class="settings-btn" data-preview-sound="tap">Клик</button>' +
                        '<button type="button" class="settings-btn" data-preview-sound="switch">Переключение</button>' +
                        '<button type="button" class="settings-btn" data-preview-sound="success">Успех</button>' +
                        '<button type="button" class="settings-btn" data-preview-sound="error">Ошибка</button>' +
                    '</div>' +
                    '<div class="settings-hint">По умолчанию звуки выключены. Настройка хранится только на этом устройстве.</div>' +
                '</section>' +

                '<section class="settings-group">' +
                    '<div class="settings-group-head"><h3>Цвета</h3><button type="button" class="settings-reset" data-reset="colors">Сброс</button></div>' +
                    '<div class="settings-color-list" id="color-list">' + colorRows() + '</div>' +
                '</section>' +

                '<section class="settings-group">' +
                    '<div class="settings-group-head"><h3>Текст</h3><button type="button" class="settings-reset" data-reset="text">Сброс</button></div>' +
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
                            '<option value="sans">Обычный</option>' +
                            '<option value="serif">С засечками</option>' +
                        '</select>' +
                    '</div>' +
                '</section>' +

                '<section class="settings-group">' +
                    '<div class="settings-group-head"><h3>Форма и отступы</h3><button type="button" class="settings-reset" data-reset="shape">Сброс</button></div>' +
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
                    '<label class="settings-toggle"><span>Анимации</span><input type="checkbox" id="motion"></label>' +
                '</section>' +

                '<section class="settings-group">' +
                    '<div class="settings-group-head"><h3>Фон</h3><button type="button" class="settings-reset" data-reset="background">Сброс</button></div>' +
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

                '<section class="settings-group">' +
                    '<div class="settings-group-head"><h3>Данные</h3></div>' +
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

        $('#sound-enabled').checked = !!s.sound.enabled;
        setRange('sound-volume', s.sound.volume, function (v) { return Math.round(v) + '%'; });
        $('#sound-pack').value = s.sound.pack;

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
            return (
                '<button type="button" class="preset-card' + (s.preset === p.id ? ' is-active' : '') + '" data-preset="' + esc(p.id) + '">' +
                    '<span class="preset-swatch" style="--sw-bg:' + esc(c.bg) + ';--sw-surface:' + esc(c.surface) + '"></span>' +
                    '<span class="preset-name">' + esc(p.name) + '</span>' +
                    '<span class="preset-share" data-share="' + esc(p.id) + '" title="Поделиться кодом">↗</span>' +
                    (p.builtin ? '' : '<span class="preset-del" data-del="' + esc(p.id) + '" title="Удалить">×</span>') +
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

    /* ---------------- open / close ---------------- */

    function open() {
        if (isOpen) return;
        isOpen = true;
        prevOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
        panel.hidden = false;
        gear.setAttribute('aria-expanded', 'true');
        sync();
        status('Сохранено');
        try { T.play('open'); } catch (e) {}
        setTimeout(function () { var b = $('#settings-close'); if (b) b.focus(); }, 0);
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        panel.hidden = true;
        document.body.style.overflow = prevOverflow;
        gear.setAttribute('aria-expanded', 'false');
        try { T.play('close'); } catch (e) {}
        gear.focus();
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
        T.setMetric('displayFont', e.target.value === 'serif' ? 'serif' : 'sans');
    });
    $('#motion').addEventListener('change', function (e) {
        T.setMetric('motion', e.target.checked);
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
})();
