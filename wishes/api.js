/*
 * Доска пожеланий - адрес «сервера».
 *
 * Это отдельный проект Apps Script с отдельной таблицей (лист «Пожелания»).
 * Библиотека осталась на своём старом адресе в books.js — два проекта
 * не мешают друг другу.
 *
 * Адрес вида
 *     https://script.google.com/macros/s/.../exec
 * меняется только если пересоздать развёртывание. Пустая строка выключает
 * отправку: доска станет только для чтения.
 */

window.WISHES_API = 'https://script.google.com/macros/s/AKfycbwjXUWpCRwCPt2dmWxzq-y9xW-kIu5wM8cH7WeFZoxspd8ncQCVkc_kT9EM83XS654j/exec';
