/*
 * Библиотека НКСЭ — приём книг через Google Таблицу.
 *
 * Это бесплатный «сервер»: сайт на GitHub Pages не умеет сохранять данные,
 * поэтому книги складываются в Google Таблицу, а этот скрипт отдаёт их сайту.
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
 * Строки, добавленные в таблицу вручную, видны, если в approved пусто или TRUE.
 */

var SHEET_NAME = 'Книги';
var AUTO_APPROVE = true;

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


/* ------------------------------------------------------------------ установка */

/**
 * Создаёт таблицу и лист «Книги». Запусти один раз вручную.
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

    Logger.log('Таблица готова: ' + ss.getUrl());
    return ss.getUrl();
}


/* ------------------------------------------------------------------ API */

function doGet(e) {
    try {
        var action = e && e.parameter ? String(e.parameter.action || 'list') : 'list';
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
            AUTO_APPROVE,
            new Date()
        ]);

        if (!AUTO_APPROVE) {
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
