/*
 * Библиотека - список книг.
 *
 * Как добавить книгу навсегда (чтобы она была на всех устройствах):
 *   1. Загрузи PDF в Google Drive.
 *   2. Правый клик по файлу -> "Поделиться" -> "Все, у кого есть ссылка" (Читатель).
 *   3. Скопируй ссылку вида https://drive.google.com/file/d/XXXXXXXX/view
 *   4. Добавь объект в массив BOOKS ниже и закоммить файл.
 *
 * Либо включи общую библиотеку: создай Google-таблицу через Apps Script
 * (файл backend/Code.gs) и вставь URL веб-приложения в LIBRARY_API ниже.
 * Тогда книги, добавленные через сайт, будут видны всем.
 *
 * Поля:
 *   driveId  - часть ссылки между /d/ и /view
 *   title    - название
 *   subtitle - уточнение (необязательно)
 *   author   - автор
 *   subject  - предмет (по нему строятся фильтры)
 *   course   - курс
 *   added    - дата добавления, ГГГГ-ММ-ДД (для сортировки "сначала новые")
 */

/*
 * URL веб-приложения Google Apps Script. Пока пусто - кнопка "Добавить"
 * сохраняет книгу только в этом браузере. После настройки backend/Code.gs
 * вставь сюда ссылку, которая заканчивается на /exec.
 */
window.LIBRARY_API = 'https://script.google.com/macros/s/AKfycbwSu-owvjvgjccX7a7tgW5OUfwv_z9zwUTdZzTGDxjHQRLTEQRUANoLeAiSX-KS1RLt/exec';

window.BOOKS = [
    {
        id: 'social-studies-spo-1',
        title: 'Обществознание',
        subtitle: 'СПО',
        author: 'Котова О. А., Лискова Т. Е.',
        subject: 'Обществознание',
        course: '1 курс',
        driveId: '11q7K4LaaoQYJaXY_RpibVSQxkOPVpGC2',
        added: '2026-10-25'
    }
];
