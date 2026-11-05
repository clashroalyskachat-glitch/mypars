/*
 * Firebase layout: меню в корне + расписание в /mypars/.
 *
 * На GitHub Pages проект живёт по адресу /mypars/ внутри домена
 * clashroalyskachat-glitch.github.io, а на Firebase тот же домен занят меню.
 * Поэтому для Firebase нельзя выкладывать dist/ в корень — это затирает меню.
 *
 * Собирает firebase-dist/:
 *   /            ← меню (отдельный репозиторий hub)
 *   /mypars/     ← наша сборка dist
 *
 * Источник меню: переменная HUB_DIR, по умолчанию ../hub рядом с репозиторием.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIST = path.join(ROOT, 'dist');
const OUT = path.join(ROOT, 'firebase-dist');
const HUB = path.resolve(process.env.HUB_DIR || path.join(ROOT, '..', 'hub'));

const die = (msg) => {
    console.error('firebase layout: ' + msg);
    process.exit(1);
};

if (!fs.existsSync(path.join(DIST, 'index.html'))) die('dist/ не собран — сначала npm run build');
if (!fs.existsSync(path.join(HUB, 'index.html'))) die('меню не найдено: ' + HUB + ' (задай HUB_DIR)');

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });

/* меню — в корень */
for (const name of fs.readdirSync(HUB)) {
    if (name === '.git') continue;
    fs.cpSync(path.join(HUB, name), path.join(OUT, name), { recursive: true });
}

/* приложение — в /mypars */
fs.cpSync(DIST, path.join(OUT, 'mypars'), { recursive: true });

const count = (dir) =>
    fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => {
        if (e.isDirectory()) return n + count(path.join(dir, e.name));
        return n + 1;
    }, 0);

/* Кэш загрузок firebase-tools живёт отдельно от файлов. Если он разойдётся с
 * реальным содержимым бакета, CLI молча пропускает файлы, и часть сайта
 * начинает отдавать 404. Полная перезаливка 46 файлов дешевле такой поломки. */
fs.rmSync(path.join(ROOT, '.firebase'), { recursive: true, force: true });

console.log('firebase layout готов: ' + OUT);
console.log('  меню:  ' + fs.readdirSync(OUT).filter((n) => n !== 'mypars').join(', '));
console.log('  /mypars: ' + count(path.join(OUT, 'mypars')) + ' файлов');
