/**
 * schedule-meta.json для деплоя.
 *
 * В репозитории лежит «историческое» время последнего реального изменения
 * расписания (updated_at). Здесь мы добавляем свежее checked_at — момент, когда
 * парсер последний раз успешно проверил сайт колледжа, — и кладём файл в dist/,
 * чтобы GitHub Pages отдавал его рядом с schedule.json.
 *
 * Сайт показывает updated_at (когда таблица реально изменилась) и по checked_at
 * понимает, что парсер жив, даже если расписание не менялось сутками.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'schedule-meta.json');
const OUT = path.join(ROOT, 'dist', 'schedule-meta.json');

let stored = {};
try {
    stored = JSON.parse(fs.readFileSync(SRC, 'utf8'));
} catch {
    stored = {};
}

const now = Date.now();
const updatedAt = Number(stored.updated_at) || now;
const payload = {
    updated_at: updatedAt,
    checked_at: now,
    groups: Number(stored.groups) || 0,
    lessons: Number(stored.lessons) || 0,
    source: stored.source || 'do.nkse.ru',
};

if (!fs.existsSync(path.dirname(OUT))) {
    throw new Error('dist/ не собран — сначала npm run build');
}
fs.writeFileSync(OUT, JSON.stringify(payload, null, 1) + '\n', 'utf8');
console.log(
    'schedule-meta.json: данные от ' +
        new Date(updatedAt).toISOString() +
        ', проверено ' +
        new Date(now).toISOString()
);
