/*
 * Доска пожеланий - аккаунт (ник и пароль).
 *
 * Отдельный модуль: страница доски подключает его первым, а app.js
 * слушает событие nkse-auth и включает/выключает отправку.
 *
 * Пароль не хранится нигде: он уходит на сервер и сразу забывается.
 * В браузере остаётся только токен сессии, его же можно выкинуть
 * кнопкой «Выйти».
 */
(function () {
    'use strict';

    var TOKEN_KEY = 'nkse-session';

    var ERRORS = {
        bad_nick: 'Ник: 3–20 знаков, буквы, цифры, _ и - (без пробелов).',
        bad_pass: 'Пароль должен быть от 6 до 100 знаков.',
        nick_taken: 'Такой ник уже занят. Попробуй другой.',
        wrong_pass: 'Неверный ник или пароль.',
        locked: 'Слишком много попыток. Подожди {minutes} мин.',
        too_many: 'Сейчас слишком много регистраций. Подожди {minutes} мин.',
        no_session: 'Войдите, чтобы продолжить.',
        network: 'Нет связи с сервисом.',
        http: 'Сервис временно недоступен — попробуй позже.',
        bad_link: 'Сервис временно недоступен — попробуй позже.',
        unknown_op: 'Сервис временно недоступен — попробуй позже.',
        unknown_action: 'Сервис временно недоступен — попробуй позже.'
    };

    var state = {
        token: '',
        user: null,
        mode: 'login',
        busy: false
    };

    var el = {};

    /* ------------------------------------------------------------- утилиты */

    function api() {
        return String(window.WISHES_API || '').trim();
    }

    function readToken() {
        try { return localStorage.getItem(TOKEN_KEY) || ''; } catch (e) { return ''; }
    }

    function writeToken(value) {
        try {
            if (value) localStorage.setItem(TOKEN_KEY, value);
            else localStorage.removeItem(TOKEN_KEY);
        } catch (e) { /* приватный режим */ }
    }

    function messageFor(data) {
        var error = data && data.error;
        var text = ERRORS[error] || 'Ошибка входа.';

        if (error === 'locked' || error === 'too_many') {
            text = text.replace('{minutes}', (data.minutes || 10));
        }
        return text;
    }

    function post(payload) {
        if (!api()) return Promise.reject({ error: 'http' });

        return fetch(api(), {
            method: 'POST',
            headers: { 'Content-Type': 'text/plain;charset=utf-8' },
            body: JSON.stringify(payload),
            redirect: 'follow'
        }).then(function (response) {
            if (!response.ok) throw { error: 'http' };
            return response.json();
        }).catch(function (error) {
            if (error && error.error) throw error;
            throw { error: 'network' };
        });
    }

    function call(payload) {
        payload.board = 'auth';
        if (state.token) payload.token = state.token;
        return post(payload);
    }

    function emit() {
        try {
            window.dispatchEvent(new CustomEvent('nkse-auth', {
                detail: { user: state.user, authed: !!state.user }
            }));
        } catch (e) { /* старый браузер - без события */ }
    }

    /* ------------------------------------------------------------- состояние */

    function isAuthed() {
        return !!state.user;
    }

    function token() {
        return state.token;
    }

    function setUser(tokenValue, user) {
        state.token = tokenValue || '';
        state.user = user || null;
        writeToken(state.token);
        render();
        emit();
    }

    function restore() {
        var saved = readToken();
        if (!saved) {
            render();
            return Promise.resolve();
        }

        state.token = saved;

        return call({ op: 'me' }).then(function (data) {
            if (data && data.ok && data.user) state.user = data.user;
            else setUser('', null);
        }).catch(function () {
            /* Нет связи: остаёмся «не вошедшим», но токен не выбрасываем. */
            state.user = null;
        }).then(function () {
            render();
            emit();
        });
    }

    /* ------------------------------------------------------------- действия */

    function submit(mode, nick, pass, pass2) {
        if (state.busy) return Promise.resolve({ error: 'busy' });

        if (!/^[A-Za-zА-Яа-яЁё0-9_-]{3,20}$/.test(nick)) return Promise.reject({ error: 'bad_nick' });
        if (pass.length < 6 || pass.length > 100) return Promise.reject({ error: 'bad_pass' });
        if (mode === 'register' && pass !== pass2) return Promise.reject({ error: 'pass_mismatch' });

        state.busy = true;
        setBusy(true);

        return call({
            op: mode,
            nick: nick,
            pass: pass,
            website: el.website ? el.website.value : ''
        }).then(function (data) {
            if (!data || data.ok !== true || !data.token) {
                throw (data && data.error ? data : { error: 'http' });
            }

            setUser(data.token, data.user);
            close();
            return data;
        }).catch(function (error) {
            showError(messageFor(error));
            throw error;
        }).then(function (data) {
            state.busy = false;
            setBusy(false);
            return data;
        }, function (error) {
            state.busy = false;
            setBusy(false);
            throw error;
        });
    }

    function logout() {
        var current = state.token;

        setUser('', null);
        close();

        if (current) {
            call({ op: 'logout', token: current }).catch(function () { /* сервер сам обчистит */ });
        }
    }

    /* ------------------------------------------------------------- диалог */

    function mode(modeName) {
        state.mode = modeName === 'register' ? 'register' : 'login';

        Array.prototype.forEach.call(el.tabs.children, function (tab) {
            var active = tab.getAttribute('data-mode') === state.mode;
            tab.setAttribute('aria-pressed', active ? 'true' : 'false');
        });

        var register = state.mode === 'register';
        el.title.textContent = register ? 'Регистрация' : 'Вход';
        el.submit.textContent = register ? 'Создать аккаунт' : 'Войти';
        el.pass2Field.hidden = !register;
        el.pass.setAttribute('autocomplete', register ? 'new-password' : 'current-password');
        el.note.textContent = register
            ? 'Аккаунт нужен, чтобы писать пожелания и отвечать в обсуждениях. Читать можно без него.'
            : 'Чтобы писать и отвечать, войди под своим ником.';

        showError('');
    }

    function open(modeName) {
        if (!el.dialog) return;
        mode(modeName || 'login');
        showError('');

        if (typeof el.dialog.showModal === 'function') el.dialog.showModal();
        else el.dialog.setAttribute('open', '');

        if (el.nick && !el.nick.value) el.nick.focus();
    }

    function close() {
        if (!el.dialog) return;
        if (typeof el.dialog.close === 'function' && el.dialog.open) el.dialog.close();
        else el.dialog.removeAttribute('open');
    }

    function showError(text) {
        if (!el.error) return;
        el.error.textContent = text || '';
        el.error.hidden = !text;
    }

    function setBusy(busy) {
        if (!el.submit) return;
        el.submit.disabled = busy;
        if (busy) el.submit.textContent = state.mode === 'register' ? 'Создаём…' : 'Проверяем…';
        else el.submit.textContent = state.mode === 'register' ? 'Создать аккаунт' : 'Войти';
    }

    function render() {
        if (el.loginBtn) el.loginBtn.hidden = !!state.user;
        if (el.user) el.user.hidden = !state.user;
        if (el.nickLabel) el.nickLabel.textContent = state.user ? state.user.nick : '';
    }

    /* ------------------------------------------------------------- запуск */

    function init() {
        el.dialog = document.getElementById('auth-dialog');
        el.form = document.getElementById('auth-form');
        el.title = document.getElementById('auth-title');
        el.tabs = document.getElementById('auth-tabs');
        el.nick = document.getElementById('auth-nick');
        el.pass = document.getElementById('auth-pass');
        el.pass2 = document.getElementById('auth-pass2');
        el.pass2Field = document.getElementById('auth-pass2-field');
        el.website = document.getElementById('auth-website');
        el.error = document.getElementById('auth-error');
        el.submit = document.getElementById('auth-submit');
        el.note = document.getElementById('auth-note');
        el.loginBtn = document.getElementById('auth-open');
        el.user = document.getElementById('auth-user');
        el.nickLabel = document.getElementById('auth-nick-label');
        el.exit = document.getElementById('auth-exit');
        el.closeBtn = document.getElementById('auth-close');

        if (el.loginBtn) {
            el.loginBtn.addEventListener('click', function () { open('login'); });
        }

        if (el.exit) el.exit.addEventListener('click', function () {
            logout();
            toast('Вы вышли из аккаунта');
        });

        if (el.closeBtn) el.closeBtn.addEventListener('click', close);

        if (el.tabs) {
            Array.prototype.forEach.call(el.tabs.children, function (tab) {
                tab.addEventListener('click', function () {
                    mode(tab.getAttribute('data-mode'));
                });
            });
        }

        if (el.form) {
            el.form.addEventListener('submit', function (event) {
                event.preventDefault();
                showError('');

                var nick = el.nick ? el.nick.value.trim() : '';
                var pass = el.pass ? el.pass.value : '';
                var pass2 = el.pass2 ? el.pass2.value : '';

                submit(state.mode, nick, pass, pass2).catch(function () { /* показано в showError */ });
            });
        }

        if (el.dialog) {
            /* Esc закрывает нативно; подчищаем ошибку на всякий случай. */
            el.dialog.addEventListener('close', function () { showError(''); });
        }

        render();
        restore();
    }

    /* Лёгкий тост не тянет за собой app.js - сообщения нужны только тут. */
    function toast(message) {
        var box = document.getElementById('toast');
        if (!box) return;
        box.textContent = message;
        box.classList.add('is-visible');
        setTimeout(function () { box.classList.remove('is-visible'); }, 3600);
    }

    window.NKSE_AUTH = {
        isAuthed: isAuthed,
        token: token,
        user: function () { return state.user; },
        open: open,
        close: close,
        logout: logout
    };

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
