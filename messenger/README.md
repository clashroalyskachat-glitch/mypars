# pps — мессенджер НКСЭ

Четвёртый раздел сайта: поиск по нику, личные чаты, QR-знакомство и звонки 1:1.
Встроен как `/mypars/messenger/` и карточка №02 в меню `hub`.

## Локальный запуск

```bash
npm run dev:messenger
```

Открой:

```text
http://127.0.0.1:8091/messenger/
```

Для двух пользователей удобно открыть `127.0.0.1` и `localhost` — это разные
origin, поэтому у них разные `localStorage` и разные сессии.

Проверка протокола без браузера (сервер должен быть запущен):

```bash
node messenger/dev-smoke.mjs
```

## Что уже работает

- локальный dev-режим (WebSocket, в памяти);
- **Supabase-режим**: вход через `nkse-session`, профиль, поиск по нику,
  история сообщений, presence, live-доставка через Realtime Broadcast;
- QR-ссылка `.../messenger/?add=<ник>`;
- WebRTC-сигналинг для аудио/видеозвонков 1:1 (тоже через Broadcast);
- тёмная/светлая тема, общая с остальным сайтом (`nkse-theme`).

## Чего ещё нет

- E2EE;
- TURN-сервера (звонки за симметричным NAT могут не пробиться);
- групповых звонков;
- автоматического импорта всех ников: профиль появляется после первого входа
  в мессенджер;
- теста звонка на двух реальных устройствах (сигналинг проверен, медиа — нет).

## Как это встроено

```text
hub/index.html            карточка «Мессенджер» → /mypars/messenger/
sz-schedule/
  messenger/index.html    UI
  messenger/styles.css
  messenger/app.js        клиент: auth, поиск, чат, QR, WebRTC
  messenger/qrcode.js     генератор QR (qrcode-generator, MIT)
  messenger/dev-server.mjs  локальный WS + статика (только разработка)
  toolchain_foundry/compiler.esbuild.mjs  копирует messenger/ в dist/
```

`npm run build` кладёт раздел в `dist/messenger/`; существующий GitHub Actions
деплоит `dist/` на GitHub Pages и (при наличии токена) в Firebase.

## Деплой без VPS

Статическая часть уже деплоится существующим workflow. Для чата и сигналинга
нужен один managed-сервис:

### Вариант A — Supabase (выбран)

- Free tier: Postgres, Realtime (WebSocket), Auth, Storage; без карты.
- Проект: `ddlbctrydkaazyitipup`.
- Таблицы: `profiles`, `chats`, `chat_members`, `messages`; `signals`
  оставлена как legacy, live-звонки идут через Realtime Broadcast.
- RLS: пользователь видит только свои чаты.
- JWT: Legacy JWT Secret (HS256) + мост из Apps Script.
- Live-доставка сообщений: Broadcast; история — REST.
- Free-проект засыпает после недели простоя; GitHub Action раз в день
  предотвращает это.

### Вариант B — Firebase Realtime Database

- Проект `nkselove` уже есть, hosting уже настроен.
- Spark: 100 одновременных подключений, 1 ГБ, 10 ГБ/мес.
- Нужен Firebase Auth; для SSO с текущими никами — custom token или
  отдельная регистрация.
- Не засыпает.

### Звонки

- 1:1 — WebRTC P2P, STUN Google уже прописан.
- Для строгих NAT — бесплатный TURN (Open Relay / Metered) или свой coturn
  позже на дешёвом VPS.
- Групповые звонки — только через SFU (LiveKit/mediasoup/Jitsi), это
  отдельный этап.

## Авторизация и существующая регистрация

Сейчас локальный dev-сервер использует свои ники. В production нужно
связать его с `library/backend/Code.gs`:

1. Пользователь входит ником/паролем в существующий Apps Script.
2. Apps Script проверяет пароль и выдаёт либо Supabase-JWT (HS256), либо
   Firebase custom token.
3. Клиент входит в Supabase/Firebase и получает `uid`.
4. `profiles.uid` связывается с ником; приватные ключи (когда появится E2EE)
   остаются на устройстве.

Это позволяет не плодить вторую регистрацию и не хранить пароли в новом месте.

## Ограничения безопасности

- Dev-сервер: пароли хешируются `scrypt`, но всё живёт в памяти и без TLS.
- Не выкладывай `dev-server.mjs` как production-бэкенд.
- WebRTC-звонки шифруются DTLS-SRTP, но signaling-сервер видит SDP.
- Для колледжа нужна минимальная модерация и rate limit.

## Следующие шаги

1. Создать Supabase-проект и SQL-схему (или включить RTDB в Firebase).
2. Перенести auth/поиск/сообщения/сигналинг на выбранный сервис.
3. Добавить TURN и проверить звонок между двумя устройствами в разных сетях.
4. Добавить E2EE (MLS) — после стабильного текста и звонков.
5. Только потом деплой: push в `main` + карточка в `hub`.
