/*
 * Доска пожеланий - логика.
 *
 * Без зависимостей и сборки. Данные приходят из Google Apps Script
 * (тот же скрипт, что обслуживает библиотеку), поэтому текст пожеланий
 * всегда выводится через textContent: чужой HTML на страницу не попадает.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------- константы */

    var KINDS = [
        { id: 'idea', label: 'Идея' },
        { id: 'note', label: 'Замечание' },
        { id: 'thanks', label: 'Спасибо' },
        { id: 'question', label: 'Вопрос' }
    ];

    var KEYS = {
        theme: 'wishes.theme',
        liked: 'wishes.liked',
        voter: 'wishes.voter',
        draft: 'wishes.draft',
        kind: 'wishes.kind',
        sort: 'wishes.sort',
        cache: 'wishes.cache',
        last: 'wishes.last'
    };

    var MAX_LEN = 600;
    var COOLDOWN_MS = 30000;
    var SVG_NS = 'http://www.w3.org/2000/svg';

    var HEART_PATH = 'M12 20.4S3.8 15.2 3.8 9.6A4.4 4.4 0 0 1 12 6.9a4.4 4.4 0 0 1 8.2 2.7c0 5.6-8.2 10.8-8.2 10.8z';

    /* ------------------------------------------------------------- элементы */

    var el = {
        topbar: document.getElementById('topbar'),
        themeBtn: document.getElementById('theme-btn'),
        heroCount: document.getElementById('hero-count'),

        form: document.getElementById('composer'),
        section: document.getElementById('composer-section'),
        addBtn: document.getElementById('add-btn'),
        addLabel: document.getElementById('add-btn-label'),
        text: document.getElementById('text'),
        name: document.getElementById('name'),
        kinds: document.getElementById('kinds'),
        counter: document.getElementById('counter'),
        submit: document.getElementById('submit'),
        submitLabel: document.getElementById('submit-label'),
        note: document.getElementById('composer-note'),
        trap: document.getElementById('website'),

        filters: document.getElementById('filters'),
        sort: document.getElementById('sort'),

        board: document.querySelector('.board'),
        notes: document.getElementById('notes'),
        loading: document.getElementById('loading'),
        empty: document.getElementById('empty'),
        emptyTitle: document.getElementById('empty-title'),
        emptyText: document.getElementById('empty-text'),
        emptyBtn: document.getElementById('empty-btn'),

        toast: document.getElementById('toast'),
        year: document.getElementById('year')
    };

    var state = {
        wishes: [],
        status: 'loading',   /* loading | ready | error */
        error: '',
        filter: 'all',
        sort: 'new',
        kind: 'idea',
        moderated: false,
        composerOpen: false
    };

    var toastTimer = null;
    var draftTimer = null;
    var reduced = false;

    try {
        reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    } catch (e) { reduced = false; }

    /* ------------------------------------------------------------- утилиты */

    function readJSON(key, fallback) {
        try {
            var raw = localStorage.getItem(key);
            if (!raw) return fallback;
            return JSON.parse(raw);
        } catch (e) {
            return fallback;
        }
    }

    function writeJSON(key, value) {
        try {
            localStorage.setItem(key, JSON.stringify(value));
        } catch (e) { /* приватный режим - просто не запоминаем */ }
    }

    function readString(key, fallback) {
        try {
            var value = localStorage.getItem(key);
            return value == null ? fallback : value;
        } catch (e) {
            return fallback;
        }
    }

    function writeString(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch (e) { /* приватный режим */ }
    }

    function plural(n, one, few, many) {
        var tail = n % 100;
        var last = n % 10;
        if (tail > 10 && tail < 20) return many;
        if (last === 1) return one;
        if (last >= 2 && last <= 4) return few;
        return many;
    }

    function kindLabel(id) {
        for (var i = 0; i < KINDS.length; i++) {
            if (KINDS[i].id === id) return KINDS[i].label;
        }
        return 'Идея';
    }

    function icon(path) {
        var svg = document.createElementNS(SVG_NS, 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.9');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');

        var shape = document.createElementNS(SVG_NS, 'path');
        shape.setAttribute('d', path);
        svg.appendChild(shape);
        return svg;
    }

    function toast(message) {
        if (!el.toast) return;
        el.toast.textContent = message;
        el.toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.toast.classList.remove('is-visible');
        }, 4200);
    }

    function todayISO() {
        var now = new Date();
        var month = String(now.getMonth() + 1);
        var day = String(now.getDate());
        if (month.length < 2) month = '0' + month;
        if (day.length < 2) day = '0' + day;
        return now.getFullYear() + '-' + month + '-' + day;
    }

    function relativeDate(value) {
        var match = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(value || ''));
        if (!match) return '';

        var then = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
        var now = new Date();
        var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
        var days = Math.round((today.getTime() - then.getTime()) / 86400000);

        if (days <= 0) return 'сегодня';
        if (days === 1) return 'вчера';
        if (days < 7) return days + ' ' + plural(days, 'день', 'дня', 'дней') + ' назад';

        var text = then.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
        return text.replace(/\.$/, '');
    }

    /* Угол наклона записки: одинаковый для одной и той же записи. */
    function rotationFor(id) {
        var hash = 0;
        var text = String(id || '');
        for (var i = 0; i < text.length; i++) {
            hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
        }
        var step = hash % 7;                 /* 0..6 */
        return (step - 3) * 0.45;            /* -1.35deg..+1.35deg */
    }

    function normalizeText(text) {
        return String(text || '')
            .toLowerCase()
            .replace(/ё/g, 'е')
            .replace(/[^a-zа-я0-9]+/g, ' ')
            .trim();
    }

    /* ------------------------------------------------------------- API */

    function api() {
        return String(window.WISHES_API || '').trim();
    }

    function isShared() {
        return !!api();
    }

    function fetchWithTimeout(url, options, ms) {
        if (typeof AbortController === 'undefined') return fetch(url, options);

        var controller = new AbortController();
        var timer = setTimeout(function () {
            controller.abort();
        }, ms || 15000);

        return fetch(url, Object.assign({}, options || {}, { signal: controller.signal }))
            .then(function (response) {
                clearTimeout(timer);
                return response;
            }, function (error) {
                clearTimeout(timer);
                throw error;
            });
    }

    /* JSONP работает даже там, где Google не отдаёт CORS-заголовки. */
    function jsonp(url, ms) {
        return new Promise(function (resolve, reject) {
            var name = 'wishCb' + Math.random().toString(36).slice(2);
            var script = document.createElement('script');
            var timer = setTimeout(function () {
                cleanup();
                reject(new Error('timeout'));
            }, ms || 15000);

            function cleanup() {
                clearTimeout(timer);
                try {
                    delete window[name];
                } catch (e) {
                    window[name] = undefined;
                }
                if (script.parentNode) script.parentNode.removeChild(script);
            }

            window[name] = function (data) {
                cleanup();
                resolve(data);
            };

            script.onerror = function () {
                cleanup();
                reject(new Error('jsonp'));
            };

            script.src = url + (url.indexOf('?') === -1 ? '?' : '&') +
                'callback=' + encodeURIComponent(name) + '&_=' + Date.now();
            document.head.appendChild(script);
        });
    }

    function getWishes() {
        var url = api() + (api().indexOf('?') === -1 ? '?' : '&') + 'action=wishes';

        return jsonp(url, 15000).catch(function () {
            return fetchWithTimeout(url, { method: 'GET', redirect: 'follow' }, 15000)
                .then(function (response) {
                    if (!response.ok) throw new Error('HTTP ' + response.status);
                    return response.json();
                });
        });
    }

    /*
     * Отправка. Если браузер не дал прочитать ответ (CORS), повторяем
     * «слепым» запросом: сервер проверяет дубли сам, поэтому лишнего
     * пожелания не появится.
     */
    function post(payload) {
        var options = {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        };

        return fetchWithTimeout(api(), options, 20000).then(function (response) {
            if (!response.ok) throw new Error('HTTP ' + response.status);
            return response.json();
        }).then(function (data) {
            if (!data || data.ok !== true) {
                var error = new Error(data && data.error ? data.error : 'server');
                error.reason = data && data.error ? data.error : 'server';
                error.fatal = true;
                throw error;
            }
            return data;
        }).catch(function (error) {
            if (error && error.fatal) throw error;

            return fetch(api(), Object.assign({ mode: 'no-cors' }, options)).then(function () {
                return { ok: true, unknown: true };
            });
        });
    }

    function voterToken() {
        var token = readString(KEYS.voter, '');
        if (token && token.length >= 8) return token;

        token = Math.random().toString(36).slice(2) + Date.now().toString(36);
        token = token.replace(/[^a-z0-9]/g, '').slice(0, 12);
        while (token.length < 8) token += '0';

        writeString(KEYS.voter, token);
        return token;
    }

    function likedIds() {
        var list = readJSON(KEYS.liked, []);
        return Array.isArray(list) ? list : [];
    }

    function isLiked(id) {
        return likedIds().indexOf(id) !== -1;
    }

    function markLiked(id, liked) {
        var list = likedIds();
        var at = list.indexOf(id);

        if (liked && at === -1) list.push(id);
        if (!liked && at !== -1) list.splice(at, 1);

        /* Список не должен расти бесконечно: держим последние 200. */
        if (list.length > 200) list = list.slice(-200);
        writeJSON(KEYS.liked, list);
    }

    /* ------------------------------------------------------------- данные */

    function normalizeWish(raw) {
        raw = raw || {};

        var kind = String(raw.kind || 'idea');
        var known = false;
        for (var i = 0; i < KINDS.length; i++) {
            if (KINDS[i].id === kind) known = true;
        }

        return {
            id: String(raw.id || ''),
            text: String(raw.text || '').slice(0, MAX_LEN),
            name: String(raw.name || '').slice(0, 32),
            kind: known ? kind : 'idea',
            likes: Math.max(0, Number(raw.likes) || 0),
            added: String(raw.added || '')
        };
    }

    function cacheWishes() {
        writeJSON(KEYS.cache, { wishes: state.wishes, moderated: state.moderated });
    }

    function load() {
        if (!isShared()) {
            state.status = 'error';
            state.error = 'no-api';
            render();
            return Promise.resolve();
        }

        state.status = 'loading';
        render();

        return getWishes().then(function (data) {
            /*
             * unknown_action значит, что на сервере всё ещё старая версия
             * скрипта без доски. Это не «нет связи», и говорить так нельзя.
             */
            if (data && data.ok === false && data.error === 'unknown_action') {
                var stale = new Error('unknown_action');
                stale.reason = 'unknown_action';
                throw stale;
            }

            if (!data || data.ok !== true || !Array.isArray(data.wishes)) {
                throw new Error(data && data.error ? data.error : 'bad-response');
            }

            state.wishes = data.wishes.map(normalizeWish);
            state.moderated = data.moderated === true;
            state.status = 'ready';
            state.error = '';
            cacheWishes();
            render();
        }).catch(function (error) {
            var cached = readJSON(KEYS.cache, null);

            if (cached && Array.isArray(cached.wishes) && cached.wishes.length) {
                state.wishes = cached.wishes.map(normalizeWish);
                state.moderated = cached.moderated === true;
                state.status = 'ready';
                render();
                toast('Нет связи — показана сохранённая копия доски');
                return;
            }

            state.status = 'error';
            state.error = error && error.reason === 'unknown_action' ? 'not-ready' : 'network';
            render();
        });
    }

    /* ------------------------------------------------------------- отрисовка */

    function visibleWishes() {
        var list = state.wishes.slice();

        if (state.filter !== 'all') {
            list = list.filter(function (wish) {
                return wish.kind === state.filter;
            });
        }

        if (state.sort === 'likes') {
            list.sort(function (a, b) {
                return b.likes - a.likes;
            });
        }

        return list;
    }

    function buildFilters() {
        if (!el.filters) return;
        el.filters.textContent = '';

        var all = document.createElement('button');
        all.type = 'button';
        all.className = 'filter';
        all.setAttribute('data-filter', 'all');
        all.textContent = 'Все';
        el.filters.appendChild(all);

        KINDS.forEach(function (kind) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'filter';
            button.setAttribute('data-filter', kind.id);
            button.setAttribute('data-kind', kind.id);
            button.textContent = kind.label;
            el.filters.appendChild(button);
        });

        Array.prototype.forEach.call(el.filters.children, function (button) {
            button.addEventListener('click', function () {
                setFilter(button.getAttribute('data-filter'));
            });
        });

        syncFilters();
    }

    function syncFilters() {
        if (!el.filters) return;

        Array.prototype.forEach.call(el.filters.children, function (button) {
            var active = button.getAttribute('data-filter') === state.filter;
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function setFilter(filter) {
        state.filter = filter;
        syncFilters();
        render();
    }

    function buildKinds() {
        if (!el.kinds) return;
        el.kinds.textContent = '';

        KINDS.forEach(function (kind) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'kind';
            button.setAttribute('data-kind', kind.id);
            button.setAttribute('aria-pressed', kind.id === state.kind ? 'true' : 'false');
            button.textContent = kind.label;

            button.addEventListener('click', function () {
                state.kind = kind.id;
                writeString(KEYS.kind, kind.id);
                syncKinds();
            });

            el.kinds.appendChild(button);
        });
    }

    function syncKinds() {
        if (!el.kinds) return;

        Array.prototype.forEach.call(el.kinds.children, function (button) {
            var active = button.getAttribute('data-kind') === state.kind;
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
        });
    }

    function noteElement(wish, index) {
        var art = document.createElement('article');
        art.className = 'note';
        art.setAttribute('data-kind', wish.kind);
        art.style.setProperty('--rot', rotationFor(wish.id || wish.text) + 'deg');
        art.style.setProperty('--delay', Math.min(index, 14) * 45 + 'ms');

        var text = document.createElement('p');
        text.className = 'note-text';
        text.textContent = wish.text;
        art.appendChild(text);

        var foot = document.createElement('footer');
        foot.className = 'note-foot';

        var kind = document.createElement('span');
        kind.className = 'note-kind';
        kind.textContent = kindLabel(wish.kind);
        foot.appendChild(kind);

        var name = document.createElement('span');
        name.className = 'note-name';
        name.textContent = wish.name || 'Аноним';
        foot.appendChild(name);

        var date = document.createElement('span');
        date.className = 'note-date';
        date.textContent = relativeDate(wish.added);
        foot.appendChild(date);

        var like = document.createElement('button');
        like.type = 'button';
        like.className = 'like';
        if (isLiked(wish.id)) like.classList.add('is-liked');
        like.appendChild(icon(HEART_PATH));

        var count = document.createElement('span');
        count.textContent = String(wish.likes);
        like.appendChild(count);

        like.setAttribute('aria-pressed', isLiked(wish.id) ? 'true' : 'false');
        like.setAttribute('aria-label', 'Нравится: ' + wish.likes);

        like.addEventListener('click', function () {
            onLike(wish, like, count);
        });

        foot.appendChild(like);
        art.appendChild(foot);

        return art;
    }

    function render() {
        if (!el.notes) return;

        var list = visibleWishes();
        var loading = state.status === 'loading';

        if (el.loading) el.loading.hidden = !loading;
        el.notes.hidden = loading;

        if (loading) {
            el.notes.textContent = '';
            if (el.empty) el.empty.hidden = true;
            el.heroCount.textContent = 'Загрузка…';
            return;
        }

        el.notes.textContent = '';
        list.forEach(function (wish, index) {
            el.notes.appendChild(noteElement(wish, index));
        });

        var empty = list.length === 0;
        if (el.empty) el.empty.hidden = !empty;

        if (empty) {
            if (state.status === 'error' && state.error === 'no-api') {
                el.emptyTitle.textContent = 'Доска ещё не подключена';
                el.emptyText.textContent = 'Совсем скоро здесь можно будет писать.';
            } else if (state.status === 'error' && state.error === 'not-ready') {
                el.emptyTitle.textContent = 'Доска пока закрыта';
                el.emptyText.textContent = 'Совсем скоро здесь можно будет писать.';
            } else if (state.status === 'error') {
                el.emptyTitle.textContent = 'Не удалось загрузить';
                el.emptyText.textContent = 'Похоже, нет связи. Обнови страницу чуть позже.';
            } else if (state.wishes.length === 0) {
                el.emptyTitle.textContent = 'Доска пока пустая';
                el.emptyText.textContent = 'Стань первым — напиши, что хочется изменить.';
            } else {
                el.emptyTitle.textContent = 'Здесь пока пусто';
                el.emptyText.textContent = 'В этой категории ещё нет пожеланий.';
            }
        }

        var total = state.wishes.length;
        if (state.status === 'error') {
            el.heroCount.textContent = (state.error === 'not-ready' || state.error === 'no-api')
                ? 'Доска пока закрыта'
                : 'Нет связи с доской';
        } else {
            el.heroCount.textContent = total === 0
                ? 'Пока ни одного пожелания'
                : total + ' ' + plural(total, 'пожелание', 'пожелания', 'пожеланий') + ' на доске';
        }

        syncComposerNote();
    }

    /* Писать можно, только если доска реально подключена. */
    function isBlocked() {
        return !isShared() || state.error === 'not-ready' || state.error === 'no-api';
    }

    /*
     * Панель письма спрятана за кнопкой: главный экран — доска.
     * Открытие показывает форму и ставит курсор, закрытие прячет её
     * с короткой анимацией (при выключенных анимациях — сразу).
     */
    function setComposerOpen(open) {
        if (!el.section || !el.addBtn) return;
        if (open === state.composerOpen) return;

        state.composerOpen = open;

        if (open) {
            el.section.classList.remove('is-closing');
            el.section.hidden = false;
            el.addBtn.setAttribute('aria-expanded', 'true');
            if (el.addLabel) el.addLabel.textContent = 'Свернуть';

            try {
                el.section.scrollIntoView({
                    behavior: reduced ? 'auto' : 'smooth',
                    block: 'nearest'
                });
            } catch (e) { /* старый браузер */ }

            if (el.text) {
                try { el.text.focus({ preventScroll: true }); }
                catch (e) { el.text.focus(); }
            }
            return;
        }

        el.addBtn.setAttribute('aria-expanded', 'false');
        if (el.addLabel) el.addLabel.textContent = 'Добавить пожелание';

        function hide() {
            el.section.hidden = true;
            el.section.classList.remove('is-closing');
            el.section.removeEventListener('animationend', hide);
        }

        if (reduced) {
            hide();
            return;
        }

        el.section.classList.add('is-closing');
        el.section.addEventListener('animationend', hide);

        /* Запасной путь: если события анимации не будет, форма всё равно спрячется. */
        setTimeout(function () {
            if (!state.composerOpen && !el.section.hidden) hide();
        }, 340);
    }

    function syncComposerNote() {
        var blocked = isBlocked();

        if (el.submit) el.submit.disabled = blocked;

        if (el.addBtn) {
            el.addBtn.disabled = blocked;
            if (blocked && state.composerOpen) setComposerOpen(false);
        }

        if (el.emptyBtn) el.emptyBtn.disabled = blocked;

        if (!el.note) return;
        if (blocked) {
            el.note.textContent = 'Доска пока не подключена — писать пока нельзя.';
            return;
        }

        el.note.textContent = state.moderated
            ? 'Пожелание появится на доске после проверки — обычно это быстро.'
            : 'Пожелание появится сразу. Спам и реклама уходят на проверку.';
    }

    /* ------------------------------------------------------------- лайки */

    function onLike(wish, button, count) {
        if (button.classList.contains('is-liked') || button.disabled) return;

        button.disabled = true;
        button.classList.add('is-liked', 'is-bump');
        button.setAttribute('aria-pressed', 'true');
        markLiked(wish.id, true);

        wish.likes += 1;
        count.textContent = String(wish.likes);
        button.setAttribute('aria-label', 'Нравится: ' + wish.likes);

        setTimeout(function () {
            button.classList.remove('is-bump');
        }, 460);

        post({ board: 'wishes', action: 'like', id: wish.id, voter: voterToken() })
            .then(function (data) {
                if (data && typeof data.likes === 'number') {
                    wish.likes = data.likes;
                    count.textContent = String(wish.likes);
                }
            })
            .catch(function () {
                /* Не подтвердилось — тихо откатываем, чтобы счёт не врал. */
                markLiked(wish.id, false);
                wish.likes = Math.max(0, wish.likes - 1);
                count.textContent = String(wish.likes);
                button.classList.remove('is-liked');
                button.setAttribute('aria-pressed', 'false');
                toast('Не удалось сохранить отметку — нет связи');
            })
            .then(function () {
                button.disabled = false;
            });
    }

    /* ------------------------------------------------------------- форма */

    function syncCounter() {
        if (!el.text || !el.counter) return;

        var length = el.text.value.length;
        el.counter.textContent = length + ' / ' + MAX_LEN;

        el.counter.classList.toggle('is-near', length > MAX_LEN * 0.8 && length < MAX_LEN);
        el.counter.classList.toggle('is-full', length >= MAX_LEN);
    }

    function saveDraft() {
        if (!el.text) return;
        var value = el.text.value;
        if (value) writeString(KEYS.draft, value);
        else {
            try { localStorage.removeItem(KEYS.draft); } catch (e) { /* нечего чистить */ }
        }
    }

    function restoreDraft() {
        if (!el.text) return;
        var draft = readString(KEYS.draft, '');
        if (draft) el.text.value = draft;
        syncCounter();
    }

    function scrollToBoard() {
        if (!el.board) return;

        try {
            el.board.scrollIntoView({
                behavior: reduced ? 'auto' : 'smooth',
                block: 'start'
            });
        } catch (e) {
            el.board.scrollIntoView();
        }
    }

    function submitWish(event) {
        if (event) event.preventDefault();
        if (!el.text) return;

        var text = el.text.value.replace(/\s+/g, ' ').trim();

        if (text.length < 3) {
            toast('Напиши хотя бы пару слов');
            el.text.focus();
            return;
        }

        if (text.length > MAX_LEN) text = text.slice(0, MAX_LEN);

        var duplicate = state.wishes.some(function (wish) {
            return normalizeText(wish.text) === normalizeText(text);
        });

        if (duplicate) {
            toast('Такое пожелание уже есть на доске');
            return;
        }

        var last = Number(readString(KEYS.last, 0)) || 0;
        var wait = COOLDOWN_MS - (Date.now() - last);

        if (wait > 0) {
            toast('Подожди ' + Math.ceil(wait / 1000) + ' с перед следующим');
            return;
        }

        if (!isShared()) {
            toast('Доска пока не подключена');
            return;
        }

        var name = el.name ? el.name.value.replace(/\s+/g, ' ').trim().slice(0, 32) : '';
        var kind = state.kind;

        el.submit.disabled = true;
        if (el.submitLabel) el.submitLabel.textContent = 'Отправляем…';

        post({
            board: 'wishes',
            action: 'add',
            text: text,
            name: name,
            kind: kind,
            website: el.trap ? el.trap.value : ''
        }).then(function (data) {
            writeString(KEYS.last, Date.now());

            if (data && data.pending) {
                toast('Спасибо! Пожелание появится после проверки');
            } else if (data && data.duplicate) {
                toast('Такое пожелание уже есть на доске');
            } else {
                var wish = data && data.wish ? normalizeWish(data.wish) : normalizeWish({
                    id: 'local-' + Date.now(),
                    text: text,
                    name: name,
                    kind: kind,
                    likes: 0,
                    added: todayISO()
                });

                /* Сервер имя не подставляет - на доске показываем «Аноним». */
                if (!wish.name) wish.name = '';

                state.wishes.unshift(wish);
                state.status = 'ready';

                if (state.filter !== 'all' && state.filter !== wish.kind) {
                    state.filter = 'all';
                    syncFilters();
                }

                cacheWishes();
                render();
                setComposerOpen(false);

                el.text.value = '';
                syncCounter();
                saveDraft();
                toast('Пожелание на доске — спасибо!');
                scrollToBoard();

                /* Если ответ пришёл «слепым» способом, сверяемся с сервером. */
                if (data && data.unknown) {
                    setTimeout(function () {
                        getWishes().then(function (fresh) {
                            if (!fresh || fresh.ok !== true || !Array.isArray(fresh.wishes)) return;
                            state.wishes = fresh.wishes.map(normalizeWish);
                            state.moderated = fresh.moderated === true;
                            syncComposerNote();
                            render();
                        }).catch(function () { /* останется локальная копия */ });
                    }, 2500);
                }
            }
        }).catch(function (error) {
            var reason = error && error.reason;

            if (reason === 'too_many') {
                toast('Сегодня лимит пожеланий исчерпан — попробуй завтра');
            } else if (reason === 'bad_text') {
                toast('Слишком короткое пожелание');
            } else if (reason === 'unknown_action') {
                toast('Доска пока не подключена');
            } else {
                toast('Не получилось отправить — проверь связь');
            }
        }).then(function () {
            el.submit.disabled = false;
            if (el.submitLabel) el.submitLabel.textContent = 'Отправить';
        });
    }

    /* ------------------------------------------------------------- тема */

    function paintTheme(theme) {
        document.documentElement.setAttribute('data-theme', theme);

        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#08080a' : '#e9e5dd');
    }

    function initTheme() {
        if (!el.themeBtn) return;

        el.themeBtn.addEventListener('click', function () {
            var next = document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
            paintTheme(next);
            writeString(KEYS.theme, next);
        });
    }

    /* ------------------------------------------------------------- запуск */

    function init() {
        initTheme();
        restoreDraft();
        buildKinds();
        buildFilters();

        state.kind = readString(KEYS.kind, 'idea');
        if (['idea', 'note', 'thanks', 'question'].indexOf(state.kind) === -1) state.kind = 'idea';
        syncKinds();

        var sort = readString(KEYS.sort, 'new');
        state.sort = sort === 'likes' ? 'likes' : 'new';
        if (el.sort) el.sort.value = state.sort;

        if (el.sort) {
            el.sort.addEventListener('change', function () {
                state.sort = el.sort.value === 'likes' ? 'likes' : 'new';
                writeString(KEYS.sort, state.sort);
                render();
            });
        }

        if (el.text) {
            el.text.addEventListener('input', function () {
                syncCounter();
                clearTimeout(draftTimer);
                draftTimer = setTimeout(saveDraft, 400);
            });
        }

        if (el.form) el.form.addEventListener('submit', submitWish);

        if (el.addBtn) {
            el.addBtn.addEventListener('click', function () {
                if (isBlocked()) {
                    toast('Доска пока не подключена');
                    return;
                }
                setComposerOpen(!state.composerOpen);
            });
        }

        if (el.emptyBtn) {
            el.emptyBtn.addEventListener('click', function () {
                if (isBlocked()) {
                    toast('Доска пока не подключена');
                    return;
                }
                setComposerOpen(true);
            });
        }

        if (el.topbar) {
            var onScroll = function () {
                el.topbar.classList.toggle('is-scrolled', window.pageYOffset > 8);
            };
            window.addEventListener('scroll', onScroll, { passive: true });
            onScroll();
        }

        if (el.year) el.year.textContent = String(new Date().getFullYear());

        load();
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
