/*
 * НКСЭ — общий «сервер» на Google Apps Script.
 *
 * Один скрипт обслуживает две вещи, у них общая таблица и один адрес /exec:
 *   • библиотеку  — лист «Книги»     (action=list,   POST без board)
 *   • доску пожеланий — лист «Пожелания» (action=wishes, POST board=wishes)
 *   • админку     — удаление и модерация (POST board=admin, пароль в
 *                   свойствах скрипта, см. раздел «АДМИНКА» внизу файла)
 *
 * Это бесплатный «сервер»: сайт на GitHub Pages не умеет сохранять данные,
 * поэтому записи складываются в Google Таблицу, а этот скрипт отдаёт их сайту.
 *
 * Как включить (один раз, ~5 минут):
 *   1. Открой https://script.google.com → «Новый проект».
 *   2. Удали код-заглушку и вставь весь этот файл.
 *   3. Нажми «Сохранить», затем запусти функцию setup (Run → setup).
 *      Google попросит разрешение — разреши доступ к таблицам.
 *   4. В журнале выполнения (Execution log) появится ссылка на таблицу.
 *      Все заявки будут в листе «Книги».
 *   5. Разверни: «Развернуть» → «Новое развёртывание» → тип «Веб-приложение»,
 *      «Запуск от имени» — ты, «Доступ» — «Все».
 *      Скопируй URL, который заканчивается на /exec.
 *   6. Вставь этот URL в books.js:
 *          window.LIBRARY_API = 'https://script.google.com/macros/s/.../exec';
 *      Закоммить и запушь. Готово: книги с сайта теперь видны всем.
 *
 * Модерация:
 *   AUTO_APPROVE = true  — книга появляется сразу (по умолчанию).
 *   AUTO_APPROVE = false — новая книга попадает в таблицу с approved = FALSE,
 *   а на сайте появится только после того, как ты поставишь TRUE.
 *   Если включишь модерацию, поменяй значение и разверни новую версию
 *   («Развернуть» → «Управление развёртываниями» → изменить → новая версия).
 *
 * Защита от вандалов (работает всегда, даже при AUTO_APPROVE = true):
 *   BURST_PER_HOUR — сколько книг за час публикуется сразу. Если кто-то
 *   присылает больше, лишние попадают в таблицу с approved = FALSE,
 *   то есть на сайт не выводятся, пока ты их не одобришь.
 *   MAX_PER_DAY — сколько книг в сутки принимается вообще; дальше сервер
 *   отвечает отказом, чтобы не завалили таблицу.
 *   Ссылка проверяется через Drive: если файла не существует (или скрипт
 *   его не видит), книга тоже уходит на проверку, а не публикуется.
 *
 * Строки, добавленные в таблицу вручную, видны, если в approved пусто или TRUE.
 *
 * Доска пожеланий (лист «Пожелания», создаётся сама при первой записи):
 *   WISH_AUTO_APPROVE = true — пожелание видно сразу;
 *   false — попадает в таблицу с approved = FALSE и ждёт твоего TRUE.
 *   WISH_BURST_PER_HOUR — сколько пожеланий за час публикуется сразу;
 *   дальше они уходят в карантин (approved = FALSE), но не теряются.
 *   WISH_MAX_PER_DAY — сколько всего принимается за сутки.
 *   Пожелание со ссылкой, почтой или длинной цепочкой одинаковых символов
 *   сразу уходит в карантин: так реклама не попадает на доску.
 */

var SHEET_NAME = 'Книги';
var AUTO_APPROVE = true;

var BURST_PER_HOUR = 6;
var MAX_PER_DAY = 40;

/* Порядок колонок. Не меняй названия, если уже есть данные. */
var HEADERS = [
    'id',
    'title',
    'subtitle',
    'author',
    'subject',
    'course',
    'driveId',
    'added',
    'approved',
    'created'
];

/* --- доска пожеланий ------------------------------------------------------ */

var WISH_SHEET_NAME = 'Пожелания';
var WISH_AUTO_APPROVE = true;

var WISH_BURST_PER_HOUR = 4;
var WISH_MAX_PER_DAY = 30;

var WISH_MAX_LEN = 600;
var WISH_MAX_NAME = 32;
var WISH_MAX_ITEMS = 400;      /* сколько последних отдаём сайту */
var WISH_MAX_VOTERS = 300;     /* сколько голосов помним в одной строке */

var WISH_HEADERS = [
    'id',
    'text',
    'name',
    'kind',
    'likes',
    'voters',
    'added',
    'approved',
    'created'
];

/* kind -> подпись. Незнакомый kind превращается в idea. */
var WISH_KINDS = ['idea', 'note', 'thanks', 'question'];


/* ------------------------------------------------------------------ установка */

/**
 * Создаёт таблицу и листы «Книги» и «Пожелания». Запусти один раз вручную.
 */
function setup() {
    var props = PropertiesService.getScriptProperties();
    var id = props.getProperty('SHEET_ID');
    var ss = null;

    if (id) {
        try {
            ss = SpreadsheetApp.openById(id);
        } catch (e) {
            ss = null;
        }
    }

    if (!ss) {
        ss = SpreadsheetApp.create('Библиотека НКСЭ — книги');
        props.setProperty('SHEET_ID', ss.getId());
    }

    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
        sheet = ss.insertSheet(SHEET_NAME);
    }

    if (sheet.getLastRow() === 0) {
        sheet.appendRow(HEADERS);
        sheet.getRange(1, 1, 1, HEADERS.length)
            .setFontWeight('bold')
            .setBackground('#1a1208')
            .setFontColor('#e3bd8c');
        sheet.setFrozenRows(1);
        sheet.setColumnWidth(1, 180);
        sheet.setColumnWidth(2, 240);
        sheet.setColumnWidth(3, 110);
        sheet.setColumnWidth(4, 210);
        sheet.setColumnWidth(5, 150);
        sheet.setColumnWidth(6, 90);
        sheet.setColumnWidth(7, 300);
        sheet.setColumnWidth(8, 100);
        sheet.setColumnWidth(9, 90);
        sheet.setColumnWidth(10, 160);
    }

    /* Лист доски пожеланий заводим заодно: он нужен и сайту, и тебе. */
    wishPrepare_(ss);

    /* Админ-пароль: генерируем один раз, если его ещё нет. */
    if (!props.getProperty(ADMIN_PROP)) {
        var generated = Utilities.getUuid().replace(/-/g, '').slice(0, 20);
        props.setProperty(ADMIN_PROP, generated);
        Logger.log('Админ-пароль (сохрани его): ' + generated);
    }

    Logger.log('Таблица готова: ' + ss.getUrl());
    Logger.log('Книги: лист «' + SHEET_NAME + '», пожелания: лист «' + WISH_SHEET_NAME + '»');
    return ss.getUrl();
}


/* ------------------------------------------------------------------ API */

function doGet(e) {
    try {
        var action = e && e.parameter ? String(e.parameter.action || 'list') : 'list';

        if (action === 'wishes') {
            return respond_({
                ok: true,
                moderated: !WISH_AUTO_APPROVE,
                wishes: wishRead_()
            }, e);
        }

        if (action !== 'list') {
            return respond_({ ok: false, error: 'unknown_action' }, e);
        }

        return respond_({
            ok: true,
            moderated: !AUTO_APPROVE,
            books: readBooks_()
        }, e);
    } catch (error) {
        return respond_({ ok: false, error: String(error && error.message || error) }, e);
    }
}

function doPost(e) {
    var lock = LockService.getScriptLock();

    try {
        lock.waitLock(15000);

        var data = parseBody_(e);

        /* Админка: удаление и модерация. Пароль проверяется на сервере. */
        if (String(data.board || '') === 'admin') {
            return respond_(adminDispatch_(data), e);
        }

        /* Запросы доски пожеланий помечены полем board. */
        if (String(data.board || '') === 'wishes') {
            return respond_(wishDispatch_(data), e);
        }

        /* Скрытое поле-ловушка: люди его не видят, боты заполняют. */
        if (data.website) {
            return respond_({ ok: true, ignored: true, moderated: !AUTO_APPROVE }, e);
        }

        var driveId = extractDriveId_(data.driveId || data.link || '');
        if (!driveId) {
            return respond_({ ok: false, error: 'bad_link' }, e);
        }

        var title = limit_(data.title, 160);
        if (!title) {
            return respond_({ ok: false, error: 'bad_title' }, e);
        }

        var sheet = openSheet_();
        var existing = findBook_(sheet, driveId);
        if (existing) {
            return respond_({
                ok: true,
                duplicate: true,
                moderated: !AUTO_APPROVE,
                book: existing
            }, e);
        }

        var recent = countRecent_(sheet);
        if (recent.day >= MAX_PER_DAY) {
            return respond_({ ok: false, error: 'too_many' }, e);
        }

        /*
         * Публикуем сразу, только если это не похоже на флуд и ссылка ведёт
         * на существующий файл Диска. Остальное сохраняем «на проверку»,
         * чтобы мусор не попал на сайт.
         */
        var instant = AUTO_APPROVE
            && recent.hour < BURST_PER_HOUR
            && fileExists_(driveId);

        var today = Utilities.formatDate(new Date(), timezone_(), 'yyyy-MM-dd');
        var book = {
            id: 'drive-' + driveId,
            title: title,
            subtitle: limit_(data.subtitle, 120),
            author: limit_(data.author, 160),
            subject: limit_(data.subject, 80) || 'Без предмета',
            course: limit_(data.course, 60),
            driveId: driveId,
            added: today
        };

        sheet.appendRow([
            book.id,
            safe_(book.title),
            safe_(book.subtitle),
            safe_(book.author),
            safe_(book.subject),
            safe_(book.course),
            driveId,
            today,
            instant,
            new Date()
        ]);

        if (!instant) {
            return respond_({ ok: true, pending: true, moderated: true }, e);
        }

        return respond_({ ok: true, moderated: false, book: book }, e);
    } catch (error) {
        return respond_({ ok: false, error: String(error && error.message || error) }, e);
    } finally {
        try {
            lock.releaseLock();
        } catch (e) { /* блокировки уже нет */ }
    }
}


/* ------------------------------------------------------------------ чтение таблицы */

function openSheet_() {
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) {
        throw new Error('Сначала запусти setup()');
    }

    var ss = SpreadsheetApp.openById(id);
    var sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) {
        throw new Error('В таблице нет листа ' + SHEET_NAME);
    }
    return sheet;
}

function readBooks_() {
    var sheet = openSheet_();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];

    var index = headerIndex_(values[0]);
    var books = [];

    for (var row = 1; row < values.length; row++) {
        var line = values[row];
        var driveId = clean_(line[index.driveId]);
        if (!driveId) continue;
        if (!isApproved_(line[index.approved])) continue;
        books.push(bookFromRow_(line, index));
    }

    books.sort(function (a, b) {
        return String(b.added).localeCompare(String(a.added));
    });

    return books;
}

/* Сколько книг добавили за последний час и за сегодня (по колонке created). */
function countRecent_(sheet) {
    var values = sheet.getDataRange().getValues();
    var result = { hour: 0, day: 0 };
    if (values.length < 2) return result;

    var index = headerIndex_(values[0]);
    var now = new Date();
    var hourAgo = now.getTime() - 60 * 60 * 1000;
    var today = Utilities.formatDate(now, timezone_(), 'yyyy-MM-dd');

    for (var row = 1; row < values.length; row++) {
        var created = values[row][index.created];
        if (Object.prototype.toString.call(created) !== '[object Date]') continue;
        if (isNaN(created.getTime())) continue;

        if (created.getTime() >= hourAgo) result.hour += 1;
        if (Utilities.formatDate(created, timezone_(), 'yyyy-MM-dd') === today) result.day += 1;
    }

    return result;
}

/*
 * Существует ли файл с таким id и видит ли его скрипт.
 * Случайный набор букв так не пройдёт — книга уйдёт на проверку.
 */
function fileExists_(driveId) {
    try {
        DriveApp.getFileById(driveId);
        return true;
    } catch (error) {
        return false;
    }
}

function findBook_(sheet, driveId) {
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return null;

    var index = headerIndex_(values[0]);

    for (var row = 1; row < values.length; row++) {
        var line = values[row];
        if (clean_(line[index.driveId]) === driveId) {
            return bookFromRow_(line, index);
        }
    }

    return null;
}

function bookFromRow_(row, index) {
    var driveId = clean_(row[index.driveId]);
    return {
        id: clean_(row[index.id]) || ('drive-' + driveId),
        title: clean_(row[index.title]) || 'Без названия',
        subtitle: clean_(row[index.subtitle]),
        author: clean_(row[index.author]),
        subject: clean_(row[index.subject]) || 'Без предмета',
        course: clean_(row[index.course]),
        driveId: driveId,
        added: dateText_(row[index.added])
    };
}

function headerIndex_(headerRow) {
    var index = {};
    for (var i = 0; i < headerRow.length; i++) {
        var name = String(headerRow[i]).trim();
        if (name) index[name] = i;
    }
    return index;
}

function isApproved_(value) {
    if (value === false) return false;
    var text = String(value == null ? '' : value).trim().toLowerCase();
    if (text === 'false' || text === 'no' || text === 'нет' || text === '0') return false;
    return true;
}


/* ------------------------------------------------------------------ мелочи */

function parseBody_(e) {
    if (!e) return {};

    if (e.postData && e.postData.contents) {
        try {
            return JSON.parse(e.postData.contents);
        } catch (error) { /* ниже попробуем параметры формы */ }
    }

    return e.parameter || {};
}

function extractDriveId_(input) {
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

function limit_(value, max) {
    return String(value == null ? '' : value)
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, max);
}

function clean_(value) {
    var text = String(value == null ? '' : value).trim();
    if (text.charAt(0) === "'") text = text.slice(1);
    return text;
}

/* Значения, начинающиеся с = + - @, Google Таблицы может принять за формулу. */
function safe_(value) {
    var text = limit_(value, 200);
    return /^[=+\-@]/.test(text) ? "'" + text : text;
}

function dateText_(value) {
    if (Object.prototype.toString.call(value) === '[object Date]' && !isNaN(value.getTime())) {
        return Utilities.formatDate(value, timezone_(), 'yyyy-MM-dd');
    }

    var text = clean_(value);
    var match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
    return match ? match[1] + '-' + match[2] + '-' + match[3] : text;
}

function timezone_() {
    return Session.getScriptTimeZone() || 'Europe/Moscow';
}

function respond_(payload, e) {
    var json = JSON.stringify(payload);
    var callback = e && e.parameter ? String(e.parameter.callback || '') : '';

    if (callback && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(callback)) {
        return ContentService
            .createTextOutput(callback + '(' + json + ');')
            .setMimeType(ContentService.MimeType.JAVASCRIPT);
    }

    return ContentService
        .createTextOutput(json)
        .setMimeType(ContentService.MimeType.JSON);
}


/* ==================================================================
 * ДОСКА ПОЖЕЛАНИЙ
 *
 * Отдельный лист «Пожелания» в той же таблице и тот же адрес /exec.
 * Сайт читает GET ?action=wishes. Пишет POST с полем board: 'wishes':
 *     { board:'wishes', action:'add',  text, name, kind, website }
 *     { board:'wishes', action:'like', id, voter }
 * ================================================================== */

function wishDispatch_(data) {
    /* Ловушка: скрытое поле, которое заполняют только боты. */
    if (data.website) {
        return { ok: true, ignored: true, moderated: !WISH_AUTO_APPROVE };
    }

    var action = String(data.action || 'add');
    if (action === 'like') return wishLike_(data);
    if (action !== 'add') return { ok: false, error: 'unknown_action' };

    return wishAdd_(data);
}


function wishAdd_(data) {
    var text = limit_(data.text, WISH_MAX_LEN);
    if (text.length < 3) return { ok: false, error: 'bad_text' };

    var kind = String(data.kind || 'idea');
    if (WISH_KINDS.indexOf(kind) === -1) kind = 'idea';

    var name = limit_(data.name, WISH_MAX_NAME);
    var sheet = wishSheet_();
    var values = sheet.getDataRange().getValues();
    var index = headerIndex_(values[0] || []);

    /* Одинаковые пожелания не плодим: второй раз просто отвечаем «уже есть». */
    var normalized = wishNormalize_(text);
    for (var row = 1; row < values.length; row++) {
        if (wishNormalize_(values[row][index.text]) === normalized) {
            return { ok: true, duplicate: true, moderated: !WISH_AUTO_APPROVE };
        }
    }

    var recent = countRecent_(sheet);
    if (recent.day >= WISH_MAX_PER_DAY) return { ok: false, error: 'too_many' };

    /*
     * Сразу публикуем только спокойный поток без ссылок. Всё подозрительное
     * остаётся в таблице с approved = FALSE — на доску оно не попадёт,
     * пока ты не поставишь TRUE.
     *
     * В счёт «сколько уже опубликовано за час» идут только видимые записи:
     * иначе один спамер своим мусором вытеснял бы в карантин чужие
     * нормальные пожелания.
     */
    var pinned = wishCountPublished_(sheet);
    var instant = WISH_AUTO_APPROVE
        && pinned.hour < WISH_BURST_PER_HOUR
        && !wishRisky_(text);

    var id = wishId_();
    var today = Utilities.formatDate(new Date(), timezone_(), 'yyyy-MM-dd');

    sheet.appendRow([
        id,
        wishSafe_(text, WISH_MAX_LEN),
        wishSafe_(name, WISH_MAX_NAME),
        kind,
        0,
        '',
        today,
        instant,
        new Date()
    ]);

    if (!instant) return { ok: true, pending: true, moderated: true };

    return {
        ok: true,
        moderated: false,
        wish: {
            id: id,
            text: text,
            name: name,
            kind: kind,
            likes: 0,
            added: today
        }
    };
}


function wishLike_(data) {
    var id = limit_(data.id, 40);
    var voter = String(data.voter || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 12);
    if (!id || voter.length < 6) return { ok: false, error: 'bad_vote' };

    var sheet = wishSheet_();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return { ok: false, error: 'not_found' };

    var index = headerIndex_(values[0]);

    for (var row = 1; row < values.length; row++) {
        var line = values[row];
        if (clean_(line[index.id]) !== id) continue;
        if (!isApproved_(line[index.approved])) return { ok: false, error: 'not_found' };

        var likes = Math.max(0, Number(line[index.likes]) || 0);
        var stored = clean_(line[index.voters]);
        var voters = stored ? stored.split(',') : [];

        /* Один голос на устройство: повторный запрос только возвращает счёт. */
        if (voters.indexOf(voter) !== -1) return { ok: true, already: true, likes: likes };

        voters.push(voter);
        if (voters.length > WISH_MAX_VOTERS) voters = voters.slice(-WISH_MAX_VOTERS);

        likes += 1;
        sheet.getRange(row + 1, index.likes + 1).setValue(likes);
        sheet.getRange(row + 1, index.voters + 1).setValue(voters.join(','));

        return { ok: true, likes: likes };
    }

    return { ok: false, error: 'not_found' };
}


function wishRead_() {
    var sheet = wishSheet_();
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];

    var index = headerIndex_(values[0]);
    var items = [];

    for (var row = 1; row < values.length; row++) {
        var line = values[row];
        if (!isApproved_(line[index.approved])) continue;

        var text = clean_(line[index.text]);
        if (!text) continue;

        var kind = clean_(line[index.kind]);
        if (WISH_KINDS.indexOf(kind) === -1) kind = 'idea';

        items.push({
            id: clean_(line[index.id]) || ('w' + row),
            text: text.slice(0, WISH_MAX_LEN),
            name: clean_(line[index.name]).slice(0, WISH_MAX_NAME),
            kind: kind,
            likes: Math.max(0, Number(line[index.likes]) || 0),
            added: dateText_(line[index.added]),
            _created: line[index.created],
            _row: row
        });
    }

    /*
     * Свежие сверху. Время в таблице может совпасть до секунды, поэтому
     * при равенстве смотрим на номер строки — она всегда растёт.
     */
    items.sort(function (a, b) {
        var at = Object.prototype.toString.call(a._created) === '[object Date]' ? a._created.getTime() : 0;
        var bt = Object.prototype.toString.call(b._created) === '[object Date]' ? b._created.getTime() : 0;
        if (bt !== at) return bt - at;
        return b._row - a._row;
    });

    items = items.slice(0, WISH_MAX_ITEMS);

    for (var i = 0; i < items.length; i++) {
        delete items[i]._created;
        delete items[i]._row;
    }
    return items;
}


/* ------------------------------------------------------------------ лист пожеланий */

function wishSheet_() {
    var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
    if (!id) throw new Error('Сначала запусти setup()');

    var ss = SpreadsheetApp.openById(id);
    var sheet = ss.getSheetByName(WISH_SHEET_NAME);

    if (!sheet || sheet.getLastRow() === 0) sheet = wishPrepare_(ss);
    return sheet;
}

/* Готовит лист «Пожелания»: заголовки, ширины, закреплённая шапка. */
function wishPrepare_(ss) {
    var sheet = ss.getSheetByName(WISH_SHEET_NAME);
    if (!sheet) sheet = ss.insertSheet(WISH_SHEET_NAME);
    if (sheet.getLastRow() > 0) return sheet;

    sheet.appendRow(WISH_HEADERS);
    sheet.getRange(1, 1, 1, WISH_HEADERS.length)
        .setFontWeight('bold')
        .setBackground('#1a1208')
        .setFontColor('#e3bd8c');
    sheet.setFrozenRows(1);

    var widths = [120, 520, 150, 110, 80, 320, 100, 90, 160];
    for (var i = 0; i < widths.length; i++) {
        sheet.setColumnWidth(i + 1, widths[i]);
    }

    return sheet;
}


/* ------------------------------------------------------------------ защита */

/*
 * Сколько пожеланий реально видно на доске за последний час.
 * Отдельно от countRecent_: тот считает все строки, включая карантин.
 */
function wishCountPublished_(sheet) {
    var values = sheet.getDataRange().getValues();
    var result = { hour: 0 };
    if (values.length < 2) return result;

    var index = headerIndex_(values[0]);
    var hourAgo = new Date().getTime() - 60 * 60 * 1000;

    for (var row = 1; row < values.length; row++) {
        var line = values[row];
        if (!isApproved_(line[index.approved])) continue;

        var created = line[index.created];
        if (Object.prototype.toString.call(created) !== '[object Date]') continue;
        if (isNaN(created.getTime())) continue;

        if (created.getTime() >= hourAgo) result.hour += 1;
    }

    return result;
}

/*
 * Что сразу отправляем в карантин:
 *   • ссылки и почту — обычный канал рекламы;
 *   • длинные цепочки одинаковых символов — «аааааааааа» и спам-заборы;
 *   • текст, где больше половины символов — заглавные или знаки.
 */
function wishRisky_(text) {
    if (/(https?:\/\/|www\.)/i.test(text)) return true;
    if (/[\w.+-]+@[\w-]+\.[a-z]{2,}/i.test(text)) return true;
    if (/(.)\1{9,}/.test(text)) return true;

    var letters = text.replace(/[^A-Za-zА-Яа-яЁё]/g, '');
    if (letters.length >= 40) {
        var caps = letters.replace(/[^A-ZА-ЯЁ]/g, '').length;
        if (caps / letters.length > 0.6) return true;
    }

    return false;
}

/* Сравнение «то же самое пожелание»: регистр, лишние пробелы и знаки не важны. */
function wishNormalize_(value) {
    return String(value == null ? '' : value)
        .toLowerCase()
        .replace(/[ё]/g, 'е')
        .replace(/[^a-zа-я0-9]+/g, ' ')
        .trim()
        .slice(0, 400);
}

function wishId_() {
    return 'w' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

/* Как safe_, но с собственным лимитом: текст пожелания длиннее 200 символов. */
function wishSafe_(value, max) {
    var text = limit_(value, max);
    return /^[=+\-@]/.test(text) ? "'" + text : text;
}


/* ==================================================================
 * АДМИНКА
 *
 * Страница /mypars/wishes/admin.html умеет удалять пожелания и книги
 * и прятать/показывать их. Пароль хранится ТОЛЬКО в свойствах скрипта
 * (Script Properties) — ни в репозитории, ни на странице его нет.
 *
 * Как включить (один раз):
 *   1. Запусти setAdminKey('свой-пароль')  —  или setup(), он сам
 *      сгенерирует случайный и напишет его в журнал выполнения.
 *   2. Разверни новую версию: Развернуть → Управление развёртываниями →
 *      карандаш → Версия: новая.
 *   3. Открой /mypars/wishes/admin.html и введи пароль.
 *
 * Оговорка: у Apps Script нет доступа к IP клиента, поэтому счётчик
 * неверных попыток общий. После ADMIN_MAX_TRY ошибок админка закрывается
 * для всех на ADMIN_LOCK_MS — перебор просто не успеет.
 * ================================================================== */

var ADMIN_PROP = 'ADMIN_KEY';
var ADMIN_FAIL_PROP = 'ADMIN_FAIL';
var ADMIN_MAX_TRY = 8;
var ADMIN_LOCK_MS = 10 * 60 * 1000;

/**
 * Задаёт админский пароль. Запусти один раз, подставив свой пароль:
 *   setAdminKey('мой-надёжный-пароль')
 */
function setAdminKey(key) {
    var value = String(key == null ? '' : key).trim();
    if (value.length < 6) {
        throw new Error('Пароль должен быть не короче 6 символов');
    }

    var props = PropertiesService.getScriptProperties();
    props.setProperty(ADMIN_PROP, value);
    props.deleteProperty(ADMIN_FAIL_PROP);

    Logger.log('Админ-пароль сохранён в свойствах скрипта (в репозитории его нет).');
    return 'ok';
}

function adminStoredKey_() {
    return String(PropertiesService.getScriptProperties().getProperty(ADMIN_PROP) || '').trim();
}

function adminFailState_() {
    try {
        var raw = PropertiesService.getScriptProperties().getProperty(ADMIN_FAIL_PROP);
        var data = raw ? JSON.parse(raw) : null;
        if (!data || typeof data !== 'object') return { n: 0, until: 0 };
        return { n: Number(data.n) || 0, until: Number(data.until) || 0 };
    } catch (error) {
        return { n: 0, until: 0 };
    }
}

function adminSaveFail_(state) {
    PropertiesService.getScriptProperties().setProperty(ADMIN_FAIL_PROP, JSON.stringify(state));
}

function adminCheck_(key) {
    var stored = adminStoredKey_();

    /* Пароль не задан - админка закрыта всегда, а не «на всякий случай». */
    if (!stored) return { ok: false, error: 'no_key' };

    var fail = adminFailState_();
    var now = new Date().getTime();

    if (fail.until > now) {
        return { ok: false, error: 'locked', minutes: Math.ceil((fail.until - now) / 60000) };
    }

    var given = String(key == null ? '' : key);
    if (given === stored) {
        adminSaveFail_({ n: 0, until: 0 });
        return { ok: true };
    }

    fail.n += 1;

    if (fail.n >= ADMIN_MAX_TRY) {
        adminSaveFail_({ n: 0, until: now + ADMIN_LOCK_MS });
        return { ok: false, error: 'locked', minutes: Math.ceil(ADMIN_LOCK_MS / 60000) };
    }

    adminSaveFail_({ n: fail.n, until: 0 });
    return { ok: false, error: 'bad_key', tries_left: ADMIN_MAX_TRY - fail.n };
}


function adminDispatch_(data) {
    var auth = adminCheck_(data.key);

    if (!auth.ok) {
        var answer = { ok: false, error: auth.error };
        if (auth.minutes) answer.minutes = auth.minutes;
        if (auth.tries_left != null) answer.tries_left = auth.tries_left;
        return answer;
    }

    var op = String(data.op || 'list');
    var target = String(data.target || 'wishes');

    if (op === 'list') {
        return { ok: true, items: target === 'books' ? adminListBooks_() : adminListWishes_() };
    }

    /* Сначала операция, потом id: иначе опечатка в op выглядит как «пустой id». */
    if (op !== 'delete' && op !== 'set') {
        return { ok: false, error: 'unknown_op' };
    }

    var id = limit_(data.id, 60);
    if (!id) return { ok: false, error: 'bad_id' };

    if (op === 'delete') return adminDelete_(target, id);

    return adminSet_(target, id, data.value);
}


function adminSheet_(target) {
    return target === 'books' ? openSheet_() : wishSheet_();
}

function adminListWishes_() {
    var sheet = adminSheet_('wishes');
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];

    var index = headerIndex_(values[0]);
    var items = [];

    for (var row = 1; row < values.length; row++) {
        var line = values[row];
        var text = clean_(line[index.text]);
        if (!text && !clean_(line[index.id])) continue;

        items.push({
            row: row + 1,
            id: clean_(line[index.id]),
            text: text.slice(0, WISH_MAX_LEN),
            name: clean_(line[index.name]),
            kind: clean_(line[index.kind]),
            likes: Math.max(0, Number(line[index.likes]) || 0),
            approved: isApproved_(line[index.approved]),
            added: dateText_(line[index.added])
        });
    }

    items.sort(function (a, b) { return b.row - a.row; });
    return items;
}

function adminListBooks_() {
    var sheet = adminSheet_('books');
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return [];

    var index = headerIndex_(values[0]);
    var items = [];

    for (var row = 1; row < values.length; row++) {
        var line = values[row];
        var title = clean_(line[index.title]);
        var driveId = clean_(line[index.driveId]);
        if (!title && !driveId) continue;

        items.push({
            row: row + 1,
            id: clean_(line[index.id]) || ('drive-' + driveId),
            title: title.slice(0, 160),
            author: clean_(line[index.author]).slice(0, 160),
            subject: clean_(line[index.subject]).slice(0, 80),
            driveId: driveId,
            approved: isApproved_(line[index.approved]),
            added: dateText_(line[index.added])
        });
    }

    items.sort(function (a, b) { return b.row - a.row; });
    return items;
}

/* Находит строку по id и возвращает её позицию (нумерация с 1). */
function adminFindRow_(sheet, id) {
    var values = sheet.getDataRange().getValues();
    if (values.length < 2) return null;

    var index = headerIndex_(values[0]);

    for (var row = 1; row < values.length; row++) {
        if (clean_(values[row][index.id]) === id) {
            return { row: row + 1, index: index };
        }
    }

    return null;
}

function adminDelete_(target, id) {
    var sheet = adminSheet_(target);
    var found = adminFindRow_(sheet, id);
    if (!found) return { ok: false, error: 'not_found' };

    sheet.deleteRow(found.row);
    return { ok: true, deleted: id };
}

function adminSet_(target, id, value) {
    var sheet = adminSheet_(target);
    var found = adminFindRow_(sheet, id);
    if (!found) return { ok: false, error: 'not_found' };

    var approved = value === true || value === 'true' || value === 1;
    sheet.getRange(found.row, found.index.approved + 1).setValue(approved);

    return { ok: true, id: id, approved: approved };
}

