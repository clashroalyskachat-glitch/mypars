/*
 * Доска пожеланий - адрес «сервера».
 *
 * Пожелания живут в той же Google Таблице, что и книги, и обслуживаются тем же
 * скриптом (library/backend/Code.gs). Поэтому адрес тот же, что в books.js:
 * отдельная настройка не нужна.
 *
 * Если когда-нибудь захочешь вынести доску в отдельный проект Apps Script,
 * просто вставь сюда ссылку вида
 *     https://script.google.com/macros/s/.../exec
 * и запушь файл. Пустая строка выключит отправку (доска станет только для чтения).
 */

window.WISHES_API = 'https://script.google.com/macros/s/AKfycbzd-umyqXbrKzvVQwPAuaEhxHql5F-kgzC8wo6TZUjjM1Q2czhvOAlZrVSPQ_A5Eqn-/exec';
