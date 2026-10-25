/*
 * Библиотека - логика.
 *
 * Никаких зависимостей и сборки: файл подключается напрямую.
 * Данные книг - в books.js, добавленные вручную - в localStorage.
 */
(function () {
    'use strict';

    /* ------------------------------------------------------------- константы */

    var KEYS = {
        theme: 'library.theme',
        favorites: 'library.favorites',
        local: 'library.local',
        last: 'library.last',
        sort: 'library.sort'
    };

    var PALETTE = [168, 201, 24, 348, 263, 132, 43, 214, 300, 8];

    var collator = new Intl.Collator('ru', { sensitivity: 'base' });

    /* ------------------------------------------------------------- элементы */

    var el = {
        topbar: document.getElementById('topbar'),
        themeBtn: document.getElementById('theme-btn'),
        addBtn: document.getElementById('add-btn'),
        heroCount: document.getElementById('hero-count'),

        resume: document.getElementById('resume'),
        resumeCover: document.getElementById('resume-cover'),
        resumeTitle: document.getElementById('resume-title'),
        resumeNote: document.getElementById('resume-note'),
        resumeBtn: document.getElementById('resume-btn'),

        search: document.getElementById('search'),
        searchClear: document.getElementById('search-clear'),
        chips: document.getElementById('chips'),
        sort: document.getElementById('sort'),

        grid: document.getElementById('grid'),
        empty: document.getElementById('empty'),
        reset: document.getElementById('reset-btn'),

        reader: document.getElementById('reader'),
        readerPanel: document.querySelector('.reader-panel'),
        readerKicker: document.getElementById('reader-kicker'),
        readerTitle: document.getElementById('reader-title'),
        readerOpen: document.getElementById('reader-open'),
        readerDelete: document.getElementById('reader-delete'),
        readerClose: document.getElementById('reader-close'),
        readerLoading: document.getElementById('reader-loading'),
        frame: document.getElementById('reader-frame'),

        dialog: document.getElementById('add-dialog'),
        form: document.getElementById('add-form'),
        addCancel: document.getElementById('add-cancel'),
        addLink: document.getElementById('add-link'),
        addLinkError: document.getElementById('add-link-error'),
        addTitle: document.getElementById('add-title'),
        addAuthor: document.getElementById('add-author'),
        addSubject: document.getElementById('add-subject'),
        addCourse: document.getElementById('add-course'),
        addExport: document.getElementById('add-export'),

        toast: document.getElementById('toast'),
        year: document.getElementById('year')
    };

    var state = {
        books: [],
        favorites: readJSON(KEYS.favorites, []),
        query: '',
        subject: 'all',
        favoritesOnly: false,
        sort: 'new',
        last: readJSON(KEYS.last, null),
        activeId: null
    };

    /* localStorage мог остаться от старой версии или быть испорчен -
       приводим данные к ожидаемому виду, чтобы интерфейс не падал. */
    if (!Array.isArray(state.favorites)) state.favorites = [];
    if (!state.last || typeof state.last !== 'object' || !state.last.id) state.last = null;

    var loadTimer = null;
    var closeTimer = null;
    var renderFrame = null;
    var toastTimer = null;
    var fitTimer = null;
    var lastFocused = null;
    var chipsKey = null;
    var gridRendered = false;

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
            return true;
        } catch (e) {
            return false;
        }
    }

    function store(key, value) {
        try {
            localStorage.setItem(key, String(value));
        } catch (e) { /* приватный режим - просто не запоминаем */ }
    }

    function plural(n, one, few, many) {
        var tail = n % 100;
        var last = n % 10;
        if (tail > 10 && tail < 20) return many;
        if (last === 1) return one;
        if (last >= 2 && last <= 4) return few;
        return many;
    }

    function hueFor(text) {
        var hash = 0;
        var value = String(text || '');
        for (var i = 0; i < value.length; i++) {
            hash = (hash * 31 + value.charCodeAt(i)) >>> 0;
        }
        return PALETTE[hash % PALETTE.length];
    }

    function driveIdFrom(input) {
        var text = String(input || '').trim();
        if (!text) return '';
        if (/^[a-zA-Z0-9_-]{20,}$/.test(text)) return text;
        var patterns = [
            /\/file\/d\/([a-zA-Z0-9_-]+)/,
            /[?&]id=([a-zA-Z0-9_-]+)/,
            /\/document\/d\/([a-zA-Z0-9_-]+)/
        ];
        for (var i = 0; i < patterns.length; i++) {
            var match = text.match(patterns[i]);
            if (match) return match[1];
        }
        return '';
    }

    function previewUrl(id) {
        return 'https://drive.google.com/file/d/' + id + '/preview';
    }

    function viewUrl(id) {
        return 'https://drive.google.com/file/d/' + id + '/view';
    }

    function formatDay(timestamp) {
        var date = new Date(timestamp);
        if (isNaN(date.getTime())) return '';
        return date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' });
    }

    function toast(message) {
        el.toast.textContent = message;
        el.toast.classList.add('is-visible');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            el.toast.classList.remove('is-visible');
        }, 2800);
    }

    function setHash(value) {
        if (!window.history || !history.replaceState) return;
        try {
            history.replaceState(null, '', value);
        } catch (e) { /* file:// или запрет на изменение истории */ }
    }

    /* ------------------------------------------------------------- данные */

    function normalize(book, index) {
        var driveId = driveIdFrom(book.driveId || book.link || '');
        if (!driveId) return null;

        var title = String(book.title || '').trim() || 'Без названия';
        var subject = String(book.subject || '').trim() || 'Без предмета';
        var author = String(book.author || '').trim();
        var course = String(book.course || '').trim();
        var subtitle = String(book.subtitle || '').trim();
        var added = book.added || '';

        return {
            id: String(book.id || 'book-' + driveId),
            title: title,
            subtitle: subtitle,
            author: author,
            subject: subject,
            course: course,
            driveId: driveId,
            added: added,
            addedTime: Date.parse(added) || 0,
            local: !!book.local,
            order: index
        };
    }

    function loadBooks() {
        var source = Array.isArray(window.BOOKS) ? window.BOOKS : [];
        var locals = readJSON(KEYS.local, []);
        if (!Array.isArray(locals)) locals = [];

        var seen = Object.create(null);
        var list = [];
        var combined = source.map(function (book) {
            return Object.assign({ local: false }, book);
        }).concat(locals.map(function (book) {
            return Object.assign({ local: true }, book);
        }));

        combined.forEach(function (book, index) {
            var normalized = normalize(book, index);
            if (!normalized || seen[normalized.driveId]) return;
            seen[normalized.driveId] = true;
            list.push(normalized);
        });

        state.books = list;
    }

    function findBook(id) {
        for (var i = 0; i < state.books.length; i++) {
            if (state.books[i].id === id) return state.books[i];
        }
        return null;
    }

    function isFavorite(id) {
        return state.favorites.indexOf(id) !== -1;
    }

    function toggleFavorite(id) {
        var index = state.favorites.indexOf(id);
        if (index === -1) {
            state.favorites.push(id);
        } else {
            state.favorites.splice(index, 1);
        }
        writeJSON(KEYS.favorites, state.favorites);
        scheduleRender();
    }

    /* ------------------------------------------------------------- сортировка */

    function compare(a, b) {
        if (state.sort === 'title') {
            return collator.compare(a.title, b.title) || collator.compare(a.author, b.author);
        }
        if (state.sort === 'author') {
            return collator.compare(a.author, b.author) || collator.compare(a.title, b.title);
        }
        return (b.addedTime - a.addedTime) ||
            collator.compare(a.title, b.title) ||
            (a.order - b.order);
    }

    function visibleBooks() {
        var query = state.query.trim().toLowerCase();
        var list = state.books.filter(function (book) {
            if (state.favoritesOnly && !isFavorite(book.id)) return false;
            if (state.subject !== 'all' && book.subject !== state.subject) return false;
            if (!query) return true;
            var haystack = [book.title, book.subtitle, book.author, book.subject, book.course]
                .join(' ')
                .toLowerCase();
            return haystack.indexOf(query) !== -1;
        });
        return list.sort(compare);
    }

    /* ------------------------------------------------------------- отрисовка */

    function scheduleRender() {
        if (renderFrame) return;
        renderFrame = requestAnimationFrame(function () {
            renderFrame = null;
            render();
        });
    }

    function render() {
        renderChips();
        renderGrid();
        renderHeroCount();
        renderResume();
        renderSearchClear();
    }

    function renderHeroCount() {
        var total = state.books.length;
        if (!total) {
            el.heroCount.textContent = 'Пока пусто - добавь первую книгу';
            return;
        }
        var subjects = Object.create(null);
        var subjectsCount = 0;
        state.books.forEach(function (book) {
            if (!subjects[book.subject]) {
                subjects[book.subject] = true;
                subjectsCount++;
            }
        });
        el.heroCount.textContent = total + ' ' + plural(total, 'книга', 'книги', 'книг') +
            ' · ' + subjectsCount + ' ' + plural(subjectsCount, 'предмет', 'предмета', 'предметов');
    }

    function renderSearchClear() {
        el.searchClear.hidden = !state.query;
    }

    function makeChip(label, value, options) {
        options = options || {};
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'chip' + (options.fav ? ' chip-fav' : '');
        button.dataset.value = value;
        button.setAttribute('aria-pressed', 'false');

        if (options.fav) {
            button.appendChild(heartIcon());
        }

        var text = document.createElement('span');
        text.textContent = label;
        button.appendChild(text);

        button.addEventListener('click', options.onClick);
        return button;
    }

    function renderChips() {
        var subjects = Object.create(null);
        var list = [];
        state.books.forEach(function (book) {
            if (!subjects[book.subject]) {
                subjects[book.subject] = true;
                list.push(book.subject);
            }
        });
        list.sort(collator.compare);

        if (state.subject !== 'all' && !subjects[state.subject]) {
            state.subject = 'all';
        }

        var key = list.join('\u0001');
        if (key !== chipsKey) {
            chipsKey = key;
            el.chips.textContent = '';

            el.chips.appendChild(makeChip('Все', 'all', {
                onClick: function () {
                    state.subject = 'all';
                    render();
                }
            }));

            list.forEach(function (subject) {
                el.chips.appendChild(makeChip(subject, subject, {
                    onClick: function () {
                        state.subject = state.subject === subject ? 'all' : subject;
                        render();
                    }
                }));
            });

            el.chips.appendChild(makeChip('Избранное', 'fav', {
                fav: true,
                onClick: function () {
                    state.favoritesOnly = !state.favoritesOnly;
                    render();
                }
            }));
        }

        Array.prototype.forEach.call(el.chips.children, function (chip) {
            var value = chip.dataset.value;
            var pressed = value === 'fav' ? state.favoritesOnly : state.subject === value;
            chip.setAttribute('aria-pressed', pressed ? 'true' : 'false');
        });
    }

    function heartIcon() {
        var svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.9');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', 'M12 20.3 4.6 13a4.8 4.8 0 0 1 6.8-6.8l.6.6.6-.6A4.8 4.8 0 0 1 19.4 13z');
        svg.appendChild(path);
        return svg;
    }

    var measureCtx = null;

    function textWidth(text, style) {
        if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
        measureCtx.font = style.fontStyle + ' ' + style.fontWeight + ' ' + style.fontSize + ' ' + style.fontFamily;
        return measureCtx.measureText(text).width;
    }

    /*
     * Названия вроде "Обществознание" не влезают в узкую обложку и
     * переносятся по буквам. Уменьшаем кегль ровно настолько, чтобы
     * самое длинное слово поместилось целиком.
     */
    function fitCoverTitles() {
        var titles = el.grid.querySelectorAll('.cover-title');
        Array.prototype.forEach.call(titles, function (node) {
            node.style.fontSize = '';
            var style = getComputedStyle(node);
            var available = node.clientWidth;
            if (!available) return;

            var widest = 0;
            (node.textContent || '').split(/\s+/).forEach(function (word) {
                widest = Math.max(widest, textWidth(word, style));
            });
            if (!widest || widest <= available) return;

            var size = parseFloat(style.fontSize);
            node.style.fontSize = Math.max(11, Math.floor(size * (available - 2) / widest)) + 'px';
        });
    }

    function renderGrid() {
        var books = visibleBooks();
        var fragment = document.createDocumentFragment();
        var instant = gridRendered;

        books.forEach(function (book, index) {
            fragment.appendChild(bookCard(book, index, instant));
        });

        el.grid.textContent = '';
        el.grid.appendChild(fragment);

        fitCoverTitles();

        el.empty.hidden = books.length > 0 || state.books.length === 0;
        el.grid.hidden = books.length === 0;

        if (instant) {
            return;
        }

        gridRendered = true;

        var cards = el.grid.querySelectorAll('.book');
        requestAnimationFrame(function () {
            requestAnimationFrame(function () {
                for (var i = 0; i < cards.length; i++) {
                    cards[i].classList.add('is-in');
                }
            });
        });
    }

    function bookCard(book, index, instant) {
        var card = document.createElement('article');
        card.className = 'book';
        card.style.setProperty('--i', String(Math.min(index, 10)));
        card.dataset.id = book.id;
        if (instant) card.classList.add('is-in');

        var cover = document.createElement('button');
        cover.type = 'button';
        cover.className = 'book-cover';
        cover.style.setProperty('--h', String(hueFor(book.subject)));
        cover.setAttribute('aria-label', 'Открыть «' + book.title + '»');

        var shine = document.createElement('span');
        shine.className = 'cover-shine';
        shine.setAttribute('aria-hidden', 'true');
        cover.appendChild(shine);

        var top = document.createElement('span');
        top.className = 'cover-top';
        var subject = document.createElement('span');
        subject.className = 'cover-subject';
        subject.textContent = book.subject;
        top.appendChild(subject);
        cover.appendChild(top);

        var title = document.createElement('span');
        title.className = 'cover-title';
        title.textContent = book.title;
        cover.appendChild(title);

        var bottom = document.createElement('span');
        bottom.className = 'cover-bottom';
        var author = document.createElement('span');
        author.className = 'cover-author';
        author.textContent = book.author || ' ';
        bottom.appendChild(author);
        cover.appendChild(bottom);

        cover.addEventListener('click', function () {
            openReader(book.id, cover);
        });

        var meta = document.createElement('div');
        meta.className = 'book-meta';

        var line = document.createElement('div');
        line.className = 'book-line';

        var heading = document.createElement('h3');
        heading.className = 'book-title';
        var titleButton = document.createElement('button');
        titleButton.type = 'button';
        titleButton.textContent = book.title;
        titleButton.addEventListener('click', function () {
            openReader(book.id, titleButton);
        });
        heading.appendChild(titleButton);

        var fav = document.createElement('button');
        fav.type = 'button';
        fav.className = 'fav';
        fav.setAttribute('aria-pressed', isFavorite(book.id) ? 'true' : 'false');
        fav.setAttribute('aria-label', (isFavorite(book.id) ? 'Убрать из избранного: ' : 'В избранное: ') + book.title);
        fav.title = 'В избранное';
        fav.appendChild(heartIcon());
        fav.addEventListener('click', function () {
            toggleFavorite(book.id);
        });

        line.appendChild(heading);
        line.appendChild(fav);
        meta.appendChild(line);

        var sub = document.createElement('p');
        sub.className = 'book-sub';
        var details = [book.author, book.course].filter(Boolean).join(' · ');
        sub.textContent = details || book.subtitle || '';
        meta.appendChild(sub);

        var tags = document.createElement('div');
        tags.className = 'book-tags';

        var subjectTag = document.createElement('span');
        subjectTag.className = 'book-tag';
        subjectTag.textContent = book.subject;
        tags.appendChild(subjectTag);

        if (book.subtitle && book.subtitle !== book.course) {
            var subtitleTag = document.createElement('span');
            subtitleTag.className = 'book-tag';
            subtitleTag.textContent = book.subtitle;
            tags.appendChild(subtitleTag);
        }

        if (book.local) {
            var localTag = document.createElement('span');
            localTag.className = 'book-tag is-local';
            localTag.textContent = 'Добавлено';
            tags.appendChild(localTag);
        }

        meta.appendChild(tags);
        card.appendChild(cover);
        card.appendChild(meta);
        return card;
    }

    function renderResume() {
        var last = state.last;
        var book = last && last.id ? findBook(last.id) : null;
        if (!book) {
            el.resume.hidden = true;
            return;
        }
        el.resume.hidden = false;
        el.resumeCover.style.setProperty('--h', String(hueFor(book.subject)));
        el.resumeTitle.textContent = book.title;
        var when = last.at ? formatDay(last.at) : '';
        el.resumeNote.textContent = when ? 'Открыта ' + when : book.subject;
        el.resumeBtn.onclick = function () {
            openReader(book.id, el.resumeBtn);
        };
    }

    /* ------------------------------------------------------------- читалка */

    function finishLoading() {
        clearTimeout(loadTimer);
        loadTimer = null;
        el.readerLoading.classList.add('is-hidden');
        el.frame.classList.add('is-ready');
    }

    function openReader(id, trigger) {
        var book = findBook(id);
        if (!book) return;

        /* Если читалка ещё закрывается - отменяем таймер, иначе он
           спрячет панель уже после повторного открытия. */
        clearTimeout(closeTimer);
        closeTimer = null;

        state.activeId = book.id;
        lastFocused = trigger || document.activeElement;

        el.readerKicker.textContent = [book.subject, book.course].filter(Boolean).join(' · ');
        el.readerTitle.textContent = book.title;
        el.readerOpen.href = viewUrl(book.driveId);
        el.readerDelete.hidden = !book.local;

        el.frame.classList.remove('is-ready');
        el.readerLoading.classList.remove('is-hidden');
        clearTimeout(loadTimer);
        loadTimer = setTimeout(finishLoading, 12000);

        el.reader.hidden = false;
        document.body.classList.add('no-scroll');

        el.frame.src = previewUrl(book.driveId);

        requestAnimationFrame(function () {
            el.reader.classList.add('is-open');
        });

        setHash('#book=' + encodeURIComponent(book.id));

        state.last = { id: book.id, at: Date.now() };
        writeJSON(KEYS.last, state.last);

        setTimeout(function () {
            if (!el.reader.hidden) el.readerClose.focus();
        }, 60);
    }

    function closeReader() {
        if (el.reader.hidden) return;

        el.reader.classList.remove('is-open');
        document.body.classList.remove('no-scroll');
        state.activeId = null;

        setHash(window.location.pathname + window.location.search);

        clearTimeout(loadTimer);
        loadTimer = null;

        closeTimer = setTimeout(function () {
            el.reader.hidden = true;
            el.frame.classList.remove('is-ready');
            el.frame.removeAttribute('src');
            el.readerLoading.classList.remove('is-hidden');
            closeTimer = null;
        }, 520);

        if (lastFocused && document.contains(lastFocused)) {
            lastFocused.focus();
        } else {
            el.readerClose.blur();
        }

        scheduleRender();
    }

    el.frame.addEventListener('load', function () {
        if (el.reader.hidden || !state.activeId) return;
        setTimeout(finishLoading, 350);
    });

    el.readerClose.addEventListener('click', closeReader);

    el.reader.querySelector('[data-close]').addEventListener('click', closeReader);

    el.readerDelete.addEventListener('click', function () {
        var book = findBook(state.activeId);
        if (!book || !book.local) return;
        if (!window.confirm('Удалить «' + book.title + '» из библиотеки?')) return;

        var locals = readJSON(KEYS.local, []);
        if (!Array.isArray(locals)) locals = [];
        locals = locals.filter(function (item) {
            return driveIdFrom(item.driveId || item.link || '') !== book.driveId;
        });
        writeJSON(KEYS.local, locals);

        closeReader();
        loadBooks();
        scheduleRender();
        toast('Книга удалена');
    });

    /* ------------------------------------------------------------- поиск */

    el.search.addEventListener('input', function () {
        state.query = el.search.value;
        scheduleRender();
    });

    el.searchClear.addEventListener('click', function () {
        el.search.value = '';
        state.query = '';
        el.search.focus();
        scheduleRender();
    });

    el.sort.addEventListener('change', function () {
        state.sort = el.sort.value;
        store(KEYS.sort, state.sort);
        scheduleRender();
    });

    el.reset.addEventListener('click', function () {
        state.query = '';
        state.subject = 'all';
        state.favoritesOnly = false;
        el.search.value = '';
        render();
        el.search.focus();
    });

    /* ------------------------------------------------------------- тема */

    function currentTheme() {
        return document.documentElement.getAttribute('data-theme') === 'dark' ? 'dark' : 'light';
    }

    function applyTheme(theme, remember) {
        document.documentElement.setAttribute('data-theme', theme);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (meta) meta.setAttribute('content', theme === 'dark' ? '#08080a' : '#e9e5dd');
        if (remember) store(KEYS.theme, theme);
    }

    el.themeBtn.addEventListener('click', function () {
        var next = currentTheme() === 'dark' ? 'light' : 'dark';
        applyTheme(next, true);
    });

    /* ------------------------------------------------------------- добавление */

    function openDialog() {
        if (typeof el.dialog.showModal === 'function') {
            el.dialog.showModal();
        } else {
            el.dialog.setAttribute('open', '');
        }
        el.addLinkError.hidden = true;
        el.addLink.classList.remove('is-invalid');
        el.addExport.hidden = !hasLocalBooks();
        setTimeout(function () {
            el.addLink.focus();
        }, 50);
    }

    function closeDialog() {
        if (typeof el.dialog.close === 'function') {
            el.dialog.close();
        } else {
            el.dialog.removeAttribute('open');
        }
    }

    function hasLocalBooks() {
        return state.books.some(function (book) {
            return book.local;
        });
    }

    el.addBtn.addEventListener('click', openDialog);
    el.addCancel.addEventListener('click', closeDialog);

    el.dialog.addEventListener('click', function (event) {
        if (event.target === el.dialog) closeDialog();
    });

    el.addLink.addEventListener('input', function () {
        el.addLinkError.hidden = true;
        el.addLink.classList.remove('is-invalid');
    });

    el.form.addEventListener('submit', function (event) {
        event.preventDefault();

        var driveId = driveIdFrom(el.addLink.value);
        if (!driveId) {
            el.addLinkError.hidden = false;
            el.addLink.classList.add('is-invalid');
            el.addLink.focus();
            return;
        }

        if (state.books.some(function (item) { return item.driveId === driveId; })) {
            toast('Эта книга уже есть в библиотеке');
            el.addLink.focus();
            return;
        }

        var title = el.addTitle.value.trim();
        if (!title) {
            el.addTitle.classList.add('is-invalid');
            el.addTitle.focus();
            return;
        }

        var book = {
            id: 'local-' + Date.now().toString(36),
            title: title,
            author: el.addAuthor.value.trim(),
            subject: el.addSubject.value.trim() || 'Без предмета',
            course: el.addCourse.value.trim(),
            driveId: driveId,
            added: new Date().toISOString().slice(0, 10),
            local: true
        };

        var locals = readJSON(KEYS.local, []);
        if (!Array.isArray(locals)) locals = [];
        locals.push(book);
        if (!writeJSON(KEYS.local, locals)) {
            toast('Браузер не дал сохранить книгу');
            return;
        }

        loadBooks();
        render();
        closeDialog();
        el.form.reset();
        el.addExport.hidden = false;
        toast('Книга добавлена');
    });

    el.addExport.addEventListener('click', function () {
        var locals = state.books.filter(function (book) {
            return book.local;
        });
        if (!locals.length) {
            toast('Пока нечего экспортировать');
            return;
        }

        var lines = locals.map(function (book) {
            return '    {\n' +
                '        title: ' + JSON.stringify(book.title) + ',\n' +
                '        author: ' + JSON.stringify(book.author) + ',\n' +
                '        subject: ' + JSON.stringify(book.subject) + ',\n' +
                '        course: ' + JSON.stringify(book.course) + ',\n' +
                '        driveId: ' + JSON.stringify(book.driveId) + ',\n' +
                '        added: ' + JSON.stringify(book.added) + '\n' +
                '    }';
        });

        var code = '/* Вставить в books.js внутрь массива BOOKS */\n' + lines.join(',\n');
        copyText(code).then(function (ok) {
            toast(ok ? 'Код скопирован - вставь в books.js' : 'Не удалось скопировать');
        });
    });

    function copyText(text) {
        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text).then(function () {
                return true;
            }).catch(function () {
                return legacyCopy(text);
            });
        }
        return Promise.resolve(legacyCopy(text));
    }

    function legacyCopy(text) {
        var area = document.createElement('textarea');
        area.value = text;
        area.setAttribute('readonly', '');
        area.style.position = 'fixed';
        area.style.top = '-1000px';
        document.body.appendChild(area);
        area.select();
        var ok = false;
        try {
            ok = document.execCommand('copy');
        } catch (e) {
            ok = false;
        }
        document.body.removeChild(area);
        return ok;
    }

    /* ------------------------------------------------------------- клавиши */

    function isTyping(target) {
        if (!target) return false;
        var tag = target.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape') {
            if (el.dialog.open) return;
            if (!el.reader.hidden) {
                event.preventDefault();
                closeReader();
            }
            return;
        }

        if (event.key === '/' && !isTyping(event.target) && el.dialog.open === false) {
            event.preventDefault();
            el.search.focus();
            el.search.select();
            return;
        }

        if (event.key === 'Tab' && !el.reader.hidden) {
            var focusables = Array.prototype.filter.call(
                el.readerPanel.querySelectorAll('a[href], button:not([disabled]), iframe, [tabindex]:not([tabindex="-1"])'),
                function (node) {
                    return node.offsetParent !== null || node.tagName === 'IFRAME';
                }
            );
            if (!focusables.length) return;

            var first = focusables[0];
            var last = focusables[focusables.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    /* ------------------------------------------------------------- прокрутка */

    var scrollTick = false;
    window.addEventListener('scroll', function () {
        if (scrollTick) return;
        scrollTick = true;
        requestAnimationFrame(function () {
            scrollTick = false;
            if (!el.topbar) return;
            el.topbar.classList.toggle('is-scrolled', window.scrollY > 8);
        });
    }, { passive: true });

    window.addEventListener('resize', function () {
        clearTimeout(fitTimer);
        fitTimer = setTimeout(fitCoverTitles, 160);
    });

    /* ------------------------------------------------------------- старт */

    function restoreSort() {
        var saved = null;
        try {
            saved = localStorage.getItem(KEYS.sort);
        } catch (e) { /* ignore */ }
        var allowed = ['new', 'title', 'author'];
        state.sort = allowed.indexOf(saved) !== -1 ? saved : 'new';
        el.sort.value = state.sort;
    }

    function openFromHash() {
        var match = window.location.hash.match(/^#book=(.+)$/);
        if (!match) return;
        var id = decodeURIComponent(match[1]);
        if (!findBook(id)) return;
        setTimeout(function () {
            openReader(id, el.search);
        }, 220);
    }

    function registerServiceWorker() {
        if (!('serviceWorker' in navigator)) return;
        if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;
        window.addEventListener('load', function () {
            navigator.serviceWorker.register('sw.js').catch(function () { /* офлайн-кэш не критичен */ });
        });
    }

    function init() {
        el.year.textContent = String(new Date().getFullYear());
        restoreSort();
        loadBooks();
        render();
        openFromHash();
        registerServiceWorker();
    }

    init();
})();
