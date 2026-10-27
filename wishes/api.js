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

window.WISHES_API = 'https://script.google.com/macros/s/AKfycbwSu-owvjvgjccX7a7tgW5OUfwv_z9zwUTdZzTGDxjHQRLTEQRUANoLeAiSX-KS1RLt/exec';
