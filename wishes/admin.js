/*
 * Админка НКСЭ - логика.
 *
 * Пароль никуда не записан: страница просто отправляет его на сервер,
 * а сервер сверяет со свойством скрипта (ADMIN_KEY в Script Properties).
 * Здесь ключ хранится только в localStorage по желанию пользователя.
 *
 * Два независимых «сервера»: пожелания живут в одном проекте Apps Script,
 * книги - в другом. Каждая вкладка ходит на свой адрес, поэтому можно
 * обновить один проект и пользоваться одной вкладкой, а второй - потом.
 */
(function () {
    'use strict';

    var KEY_STORE = 'nkse-admin-key';

    var KIND_LABELS = {
        idea: 'Идея',
        note: 'Замечание',
        thanks: 'Спасибо',
        question: 'Вопрос'
    };

    /* Тексты ошибок - своими словами, без технических кодов. */
    var REASONS = {
        bad_key: 'Неверный пароль.',
        no_key: 'На сервере не задан пароль: запусти setAdminKey(\'...\') в редакторе Apps Script и раздеплой новую версию.',
        locked: 'Слишком много неверных попыток - админка закрыта. Подожди {minutes} мин.',
        unknown_action: 'Сервер ещё старый: вставь новый Code.gs в проект Apps Script и раздеплой новую версию.',
        bad_link: 'Сервер ещё старый: вставь новый Code.gs в проект Apps Script и раздеплой новую версию.',
        not_found: 'Не найдено - возможно, уже удалено.',
        bad_id: 'Ничего не выбрано.',
        unknown_op: 'Неизвестная операция.',
        no_api: 'Не задан адрес API.',
        http: 'Сервер не ответил.',
        network: 'Нет связи с сервером.'
    };

    var state = {
        key: '',
        target: 'wishes',
        items: { wishes: [], books: [] },
        counts: { wishes: null, books: null },
        onlyHidden: false,
        pending: null,     /* id, по которому ждём подтверждения */
        busy: false
    };

    var el = {
        topbar: document.getElementById('topbar'),
        logout: document.getElementById('logout'),

        gate: document.getElementById('gate'),
        gateForm: document.getElementById('gate-form'),
        key: document.getElementById('key'),
        remember: document.getElementById('remember'),
        unlock: document.getElementById('unlock'),
        gateError: document.getElementById('gate-error'),

        panel: document.getElementById('panel'),
        tabs: document.getElementById('tabs'),
        countWishes: document.getElementById('count-wishes'),
        countBooks: document.getElementById('count-books'),
        showHidden: document.getElementById('show-hidden'),
        status: document.getElementById('status'),
        refresh: document.getElementById('refresh'),
        items: document.getElementById('items'),
        empty: document.getElementById('items-empty'),
        emptyTitle: document.getElementById('items-empty-title'),

        toast: document.getElementById('toast')
    };

    var toastTimer = null;

    /* ------------------------------------------------------------- мелочи */

    function readStore(key) {
        try { return localStorage.getItem(key); } catch (e) { return null; }
    }

    function writeStore(key, value) {
        try {
            if (value == null) localStorage.removeItem(key);
            else localStorage.setItem(key, value);
        } catch (e) { /* приватный режим */ }
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

    function setStatus(text) {
        if (el.status) el.status.textContent = text;
    }

    function showGateError(message) {
        if (!el.gateError) return;
        el.gateError.textContent = message || '';
        el.gateError.hidden = !message;
    }

    function plural(n, one, few, many) {
        var tail = n % 100;
        var last = n % 10;
        if (tail > 10 && tail < 20) return many;
        if (last === 1) return one;
        if (last >= 2 && last <= 4) return few;
        return many;
    }

    function messageFor(data) {
        var error = data && data.error;
        var text = REASONS[error] || 'Ошибка запроса.';

        if (error === 'locked' && data.minutes) {
            text = text.replace('{minutes}', data.minutes);
        }
        if (error === 'bad_key' && data.tries_left != null) {
            text += ' Осталось попыток: ' + data.tries_left + '.';
        }
        return text;
    }

    function isAuthError(data) {
        var error = data && data.error;
        return error === 'bad_key' || error === 'locked' || error === 'no_key';
    }

    function failWith(data) {
        var error = new Error('server');
        error.data = data;
        return error;
    }

    /* ------------------------------------------------------------- API */

    function wishApi() {
        return String(window.WISHES_API || '').trim();
    }

    function bookApi() {
        return String(window.LIBRARY_API || '').trim();
    }

    function apiFor(target) {
        return target === 'books' ? bookApi() : wishApi();
    }

    function post(api, payload) {
        if (!api) return Promise.reject(failWith({ error: 'no_api' }));

        return fetch(api, {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        }).then(function (response) {
            if (!response.ok) return Promise.reject(failWith({ error: 'http' }));
            return response.json();
        }).catch(function (error) {
            if (error && error.data) throw error;
            throw failWith({ error: 'network' });
        });
    }

    function call(target, payload) {
        payload.board = 'admin';
        payload.target = target;
        payload.key = state.key;
        return post(apiFor(target), payload);
    }

    /* ------------------------------------------------------------- загрузка */

    function load(target) {
        state.pending = null;
        if (target === state.target) setStatus('Загрузка…');

        return call(target, { op: 'list' }).then(function (data) {
            if (!data || data.ok !== true) throw failWith(data);

            state.items[target] = Array.isArray(data.items) ? data.items : [];
            state.counts[target] = state.items[target].length;

            if (target === state.target) render();
            else updateCounts();

            return true;
        });
    }

    function updateCounts() {
        if (el.countWishes) el.countWishes.textContent = state.counts.wishes == null ? '—' : String(state.counts.wishes);
        if (el.countBooks) el.countBooks.textContent = state.counts.books == null ? '—' : String(state.counts.books);
    }

    /* ------------------------------------------------------------- отрисовка */

    function visibleItems() {
        var list = state.items[state.target] || [];

        if (state.onlyHidden) {
            list = list.filter(function (item) { return !item.approved; });
        }

        return list;
    }

    function metaText(item) {
        var parts = [];

        if (state.target === 'wishes') {
            if (item.name) parts.push(item.name);
            if (item.likes) parts.push(item.likes + ' ' + plural(item.likes, 'голос', 'голоса', 'голосов'));
        } else {
            if (item.subject) parts.push(item.subject);
            if (item.driveId) parts.push('диск: ' + item.driveId.slice(0, 10) + '…');
        }

        if (item.added) parts.push(item.added);
        if (item.row) parts.push('строка ' + item.row);

        return parts.join(' · ');
    }

    function itemElement(item) {
        var box = document.createElement('div');
        box.className = 'item' + (item.approved ? '' : ' is-hidden-item');

        var head = document.createElement('div');
        head.className = 'item-head';

        var status = document.createElement('span');
        status.className = 'chip' + (item.approved ? '' : ' chip-off');
        status.textContent = item.approved ? 'Видно' : 'Скрыто';
        head.appendChild(status);

        if (state.target === 'wishes' && item.kind) {
            var kind = document.createElement('span');
            kind.className = 'chip chip-kind';
            kind.textContent = KIND_LABELS[item.kind] || KIND_LABELS.idea;
            head.appendChild(kind);
        }

        var meta = document.createElement('span');
        meta.className = 'item-meta';
        meta.textContent = metaText(item);
        head.appendChild(meta);

        box.appendChild(head);

        /* Текст только через textContent: в таблицу могли записать что угодно. */
        var text = document.createElement('p');
        text.className = 'item-text';
        text.textContent = state.target === 'books'
            ? (item.title || 'Без названия') + (item.author ? ' — ' + item.author : '')
            : (item.text || '');
        box.appendChild(text);

        var actions = document.createElement('div');
        actions.className = 'item-actions';

        var toggle = document.createElement('button');
        toggle.type = 'button';
        toggle.className = 'btn btn-ghost';
        toggle.textContent = item.approved ? 'Скрыть' : 'Показать';
        toggle.disabled = state.busy;
        toggle.addEventListener('click', function () {
            setApproved(item, !item.approved);
        });
        actions.appendChild(toggle);

        var remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'btn btn-danger';
        remove.textContent = state.pending === item.id ? 'Точно удалить?' : 'Удалить';
        remove.disabled = state.busy;
        remove.addEventListener('click', function () {
            removeItem(item);
        });
        actions.appendChild(remove);

        box.appendChild(actions);
        return box;
    }

    function render() {
        if (!el.items) return;

        var list = visibleItems();
        el.items.textContent = '';

        list.forEach(function (item) {
            el.items.appendChild(itemElement(item));
        });

        if (el.empty) {
            el.empty.hidden = list.length > 0;
            el.emptyTitle.textContent = state.onlyHidden
                ? 'Скрытых записей нет'
                : 'Здесь пока пусто';
        }

        updateCounts();

        var all = state.items[state.target] || [];
        var hidden = all.filter(function (item) { return !item.approved; }).length;
        var noun = state.target === 'books'
            ? plural(all.length, 'книга', 'книги', 'книг')
            : plural(all.length, 'пожелание', 'пожелания', 'пожеланий');

        setStatus(all.length + ' ' + noun + (hidden ? ' · скрыто ' + hidden : ''));
    }

    /* ------------------------------------------------------------- действия */

    function run(payload, okText) {
        if (state.busy) return Promise.resolve();

        state.busy = true;
        state.pending = null;
        setStatus('Сохраняем…');

        var target = state.target;

        return call(target, payload).then(function (data) {
            if (!data || data.ok !== true) throw failWith(data);
            toast(okText);
            return load(target);
        }).catch(function (error) {
            handleError(error);
        }).then(function () {
            state.busy = false;
            if (state.target === target) render();
        });
    }

    function setApproved(item, approved) {
        run({ op: 'set', id: item.id, value: approved },
            approved ? 'Показано' : 'Скрыто');
    }

    function removeItem(item) {
        /* Двойное натужие: случайный клик ничего не ломает. */
        if (state.pending !== item.id) {
            state.pending = item.id;
            render();
            toast('Нажми ещё раз, чтобы подтвердить удаление');
            return;
        }

        run({ op: 'delete', id: item.id }, 'Удалено');
    }

    function handleError(error) {
        var data = error && error.data;

        if (isAuthError(data)) {
            lockPanel(messageFor(data));
            return;
        }

        setStatus(messageFor(data));
        toast(messageFor(data));
    }

    function lockPanel(message) {
        state.key = '';
        state.pending = null;
        writeStore(KEY_STORE, null);

        if (el.panel) el.panel.hidden = true;
        if (el.gate) el.gate.hidden = false;
        if (el.logout) el.logout.hidden = true;
        if (el.key) el.key.value = '';

        showGateError(message);
        setUnlockBusy(false);
    }

    function setUnlockBusy(busy) {
        if (!el.unlock) return;
        el.unlock.disabled = busy;
        el.unlock.textContent = busy ? 'Проверяем…' : 'Войти';
    }

    function showPanel() {
        if (el.gate) el.gate.hidden = true;
        if (el.panel) el.panel.hidden = false;
        if (el.logout) el.logout.hidden = false;
        showGateError('');
    }

    /* ------------------------------------------------------------- вкладки */

    function switchTab(target) {
        if (target === state.target) return;

        state.target = target;
        state.pending = null;

        Array.prototype.forEach.call(el.tabs.children, function (tab) {
            tab.setAttribute('aria-pressed', tab.getAttribute('data-target') === target ? 'true' : 'false');
        });

        render();

        /* Данные есть - перерисовали сразу, фоном всё равно обновляем. */
        load(target).catch(handleError);
    }

    /* ------------------------------------------------------------- вход */

    function unlock(event) {
        if (event) event.preventDefault();

        var value = el.key ? el.key.value : '';
        if (!value) {
            showGateError('Введи пароль.');
            return;
        }

        state.key = value;
        showGateError('');
        setUnlockBusy(true);

        load(state.target).then(function () {
            if (el.remember && el.remember.checked) writeStore(KEY_STORE, value);
            else writeStore(KEY_STORE, null);

            setUnlockBusy(false);
            showPanel();
            toast('Открыто');
        }).catch(function (error) {
            var data = error && error.data;
            setUnlockBusy(false);

            /*
             * Не наш пароль - закрываем и забываем сохранённый ключ,
             * он больше не поможет. Сетевая ошибка - просто сообщаем:
             * стёрть из-за плохой связи чужой пароль было бы глупо.
             */
            if (isAuthError(data)) {
                lockPanel(messageFor(data));
                return;
            }

            showGateError(messageFor(data));
        });
    }

    function logout() {
        lockPanel('');
        toast('Вы вышли');
    }

    /* ------------------------------------------------------------- запуск */

    function init() {
        if (el.topbar) {
            var onScroll = function () {
                el.topbar.classList.toggle('is-scrolled', window.pageYOffset > 8);
            };
            window.addEventListener('scroll', onScroll, { passive: true });
            onScroll();
        }

        if (el.gateForm) el.gateForm.addEventListener('submit', unlock);
        if (el.logout) el.logout.addEventListener('click', logout);

        if (el.tabs) {
            Array.prototype.forEach.call(el.tabs.children, function (tab) {
                tab.addEventListener('click', function () {
                    switchTab(tab.getAttribute('data-target'));
                });
            });
        }

        if (el.showHidden) {
            el.showHidden.addEventListener('change', function () {
                state.onlyHidden = el.showHidden.checked;
                state.pending = null;
                render();
            });
        }

        if (el.refresh) {
            el.refresh.addEventListener('click', function () {
                if (!state.key) return;
                load(state.target).then(function () {
                    toast('Обновлено');
                }).catch(handleError);
            });
        }

        /* Сохранённый пароль: пробуем открыть сразу, без поля. */
        var saved = readStore(KEY_STORE);
        if (saved && el.key) {
            el.key.value = saved;
            if (el.remember) el.remember.checked = true;
            unlock(null);
        } else if (el.key) {
            el.key.focus();
        }
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
