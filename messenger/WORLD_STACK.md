# Мировой стек для мессенджера — карта по узлам

Дата: ноябрь 2026. Задача: найти лучшие в мире технологии для каждого узла
передачи данных и понять, что из этого реально даёт скорость.

---

## 0. Как читать

Единого «рейтинга лучших технологий» не существует. Есть четыре вида доказательств:

1. **Независимые бенчмарки** — http-arena (заменил TechEmpower, закрытый в марте 2026),
   Lemire, AnyCable, CDNPerf.
2. **Продакшн-масштаб** — Discord, Telegram, WhatsApp, Signal: что они реально держат.
3. **Популярность** — DB-Engines, Stack Overflow Survey.
4. **Замеры на нашем проекте** — единственное, что важно для нас.

Для каждого узла ниже: лучшее в мире → чем подтверждено → что у нас → вердикт.

---

## 1. Главный вывод: «лучшее из каждого» не складывается

Скорость — это не сумма скоростей компонентов. Это **бюджет задержки**:

```
клик → [RTT 1] → [RTT 2] → [RTT 3] → экран
```

Замеры нашего продакшна:

- RTT до Supabase: **130–215 мс** на запрос.
- Открытие чата: 3 запроса подряд = **350–520 мс**.
- Отправка: 1 запрос = **137 мс**.

Теперь сравним с «лучшим в мире» сервером:

| Что | Время |
|---|---|
| C-релей, круг сообщения (Lemire, 2026) | **18.4 µs** |
| Node.js + uWebSockets.js | **20.4 µs** |
| Bun | 26.8 µs |
| Разница между лучшим и худшим сервером | **~8 µs** |
| Наш сетевой RTT | **137 000 µs** |

Разница между лучшим и худшим WebSocket-сервером — **0.006%** нашей задержки.
Убрать один лишний запрос — **100%** одного RTT.

Вывод: переписать сервер на C++/Rust ради 2–8 µs бессмысленно.
Убрать третий запрос при открытии чата — огромно.

---

## 2. Карта узлов

| Узел | Лучшее в мире | Подтверждение | У нас | Вердикт |
|---|---|---|---|---|
| Клиент | Нативные приложения (Telegram: C++/Rust/Java/Swift) | Telegram, WhatsApp | Браузер, ванильный JS | Браузер — наше ограничение, не лечится языком |
| Транспорт | Custom binary over TCP (WhatsApp), MTProto (Telegram) | 2M соединений/сервер | WebSocket (Supabase Realtime) | Для браузера WebSocket — правильный выбор |
| Realtime-шлюз | Erlang/BEAM (WhatsApp), uWebSockets (C++), AnyCable (Go) | 2M / 1M / 822K соединений | Phoenix Channels (внутри Supabase) | Порождающая база хорошая, но мы ходим в неё REST-ом |
| Раздача (fanout) | uWS 2 мс p50, AnyCable 4 мс p50 на 10K подписчиков | AnyCable 2026 | Broadcast + postgres_changes | Достаточно; не узкое место |
| Хранилище сообщений | ScyllaDB (C++) | Discord: 72 ноды, p99 15 мс | Postgres | Для колледжа Postgres быстрее и удобнее |
| Метаданные | Postgres | DB-Engines: лидер роста H1 2026 | Postgres | Правильно |
| Кэш | Dragonfly / Redis | ~1M ops/s у Dragonfly | Нет серверного кэша | Не нужен; нужен клиентский |
| Очередь | Redpanda (C++), NATS JetStream (Go) | ниже p99, чем Kafka | Нет | Не нужна при нашем объёме |
| Медиа 1:1 | P2P WebRTC | задержка ниже любого SFU | P2P | Правильно |
| Медиа группы | mediasoup (C++), LiveKit (Go), Janus (C) | 7–18K звёзд, продакшн | Нет групп | Не сейчас |
| TURN | Cloudflare Calls, LiveKit Cloud, Twilio NTS | платные/лимитные | openrelay (free) | Слабое место по надёжности, не по скорости |
| Файлы | R2 / Bunny / S3 + CDN | CDNPerf | Google Drive через Apps Script | **Главный тормоз** |
| CDN | Cloudflare / Bunny / Fastly | CDNPerf | Firebase Hosting | Нормально для статики |
| Авторизация | Ory Kratos, Zitadel, Supabase Auth | продакшн | Apps Script + Google Sheets | 3 с, но раз в 30 дней |
| Push | FCM + APNs | безальтернативно для веба | FCM через Apps Script | FCM хорош, отправитель плох |
| Сериализация | Protobuf / FlatBuffers / Cap'n Proto | компактность и zero-copy | JSON | На RTT не влияет |
| Шифрование | Signal Protocol (1:1), MLS (группы) | стандарт | Нет E2EE | Пробел безопасности, не скорости |
| Edge-вычисления | Cloudflare Workers (V8 isolates), Fastly Compute (Wasm) | ~0 мс холодного старта | Apps Script (2.6–3.5 с) | **Заменить** |
| Язык сервера | Rust / Go / C++ / Elixir | см. таблицу выше | JS в браузере + Apps Script | Переписывать нечего: серверного кода почти нет |
| Наблюдаемость | OpenTelemetry + Prometheus + Grafana | стандарт | Консоль и логи | Не влияет на скорость |

---

## 3. Разбор ключевых узлов

### 3.1 Транспорт

- **WebSocket** — единственный транспорт с поддержкой во всех браузерах.
  Поверх него Supabase Realtime гоняет Phoenix Channels (Elixir) — это хорошая школа.
- **WebTransport (HTTP/3, QUIC)** — меньше head-of-line blocking, датаграммы.
  В 2026 поддерживается не везде; для текстового чата выигрыш около нуля,
  потому что сообщения мелкие и редкие.
- **MQTT** — хорош для IoT и пушей, но требует брокера и плохо ложится на браузер.
- **Custom binary (WhatsApp/Telegram)** — максимальная плотность и размер пакета,
  но требует нативного клиента. В браузере недоступен.

**Вердикт:** WebSocket — правильный выбор. Менять нечего.

### 3.2 Realtime-шлюз и fanout

Цифры 2026:

- uWebSockets.js: **1 018 366** соединений на 32 ГБ, **5.4 КБ** на соединение,
  2 мс p50 / 10 мс p99 при 10K подписчиков.
- AnyCable (Go): **822 000** соединений, 18–34 КБ, надёжные стримы, 100% доставка при обрывах.
- Socket.io: **120 000** соединений, 52 КБ, 85% доставка при jitter.

Нам не нужно ни то, ни другое: у нас десятки пользователей.
Важно другое — **надёжность доставки**: Socket.io/uWS теряют ~15% при обрывах,
AnyCable/Supabase с replay — 0%.

**Вердикт:** Supabase Realtime достаточен. Улучшать нужно не throughput, а
количество запросов и локальный кэш.

### 3.3 Хранилище сообщений

- ScyllaDB 6: **1.82M записей/с**, p99 **18 мс** на 500 ГБ (бенчмарк 2026).
- PostgreSQL 19: **432K записей/с**, p99 **210 мс** на 500 ГБ (там же).
- Discord: перешёл с Cassandra на ScyllaDB, кластер 177 → 72 ноды, p99 чтения
  125 мс → **15 мс**.

Но: у нас база на несколько тысяч сообщений. Запрос к Postgres занимает
единицы миллисекунд, а **137 мс — это сеть, а не база**.
ScyllaDB даст выигрыш только при миллиардах строк и своей инфраструктуре.

**Вердикт:** Postgres — правильный выбор. Не менять.

### 3.4 Файлы и CDN

- Google Drive — не CDN: отдача через редиректы, лимиты, медленный первый байт.
- R2 / Bunny / S3 + CDN — прямая загрузка и кэш на краю.
- CDNPerf измеряет TTFB по странам; Cloudflare/Bunny/Fastly стабильно в топе.

**Вердикт:** это второй по величине тормоз после Apps Script.
Заменить на Supabase Storage (уже есть в проекте) или R2.

### 3.5 Push

FCM/APNs — безальтернативны для веба и iOS. Проблема не в них,
а в том, что отправка идёт через Apps Script (3 с). Database Webhook →
Edge Function → FCM даёт 0.3–0.8 с.

### 3.6 Авторизация

Ory Kratos и Zitadel — лучшие self-hosted. Supabase Auth — лучший managed.
Но у нас пароли в Google Sheets, и вход нужен раз в 30 дней.
Тратить силы на миграцию ради 3 секунд раз в месяц — плохой размен.

**Вердикт:** оставить, убрать из горячего пути.

---

## 4. Dream stack против реального

### Если бы денег и времени было сколько угодно

```
Клиент:      нативные приложения (Kotlin/Swift) + Rust-ядро
Транспорт:   WebTransport/QUIC + FlatBuffers
Шлюз:        Cloudflare Durable Objects по чату + Workers
Раздача:     NATS / Redpanda
Хранилище:   ScyllaDB (сообщения) + Postgres (метаданные)
Файлы:       R2 + CDN
Звонки:      LiveKit SFU + глобальный TURN
Авторизация: Ory Kratos
Push:        FCM/APNs напрямую
Деплой:      мультирегион
```

Это команда из 10–20 человек и бюджет в миллионы. Для колледжа — абсурд.

### Реальный стек, который даёт 90% эффекта бесплатно

```
Клиент:      текущий + local-first кэш (IndexedDB)
Транспорт:   WebSocket (Supabase Realtime)
Открытие:    один RPC + кэш chat_id
Файлы:       Supabase Storage (1 ГБ free) / R2
Push:        DB Webhook → Edge Function → FCM
Удаление:    RLS UPDATE
Звонки:      P2P + нормальный TURN
База:        Supabase Postgres в ближайшем регионе
```

Это то, что описано в `SPEED.md`, и это реально сделать за вечера.

---

## 5. Что реально даст скорость (по убыванию)

1. **Убрать лишние round-trip'ы** — открытие чата 3 → 1 запрос: −200…−350 мс.
2. **Локальный кэш** — повторное открытие: −350…−520 мс (до 0).
3. **Убрать Apps Script из горячего пути** — удаление/файлы/push: −2.5…−14 с.
4. **Ближайший регион базы** — −80…−100 мс на каждый запрос.
5. **Отправка по WebSocket + ack** — доставка −100…−150 мс.
6. **Префетч** — открытие впервые: −200 мс субъективно.
7. **Сжатие картинок на клиенте** — уже сделано.
8. **Бинарная сериализация** — экономит байты, не время. Не делать.
9. **Переписывание на C++/Rust** — 2–8 µs. Не делать.

---

## 6. Лаборатория: что скачать, собрать и померить

Чтобы не спорить вкусами, нужен воспроизводимый стенд.

### 6.1 Инструменты

| Инструмент | Что меряет |
|---|---|
| `k6` (ws) | p50/p95/p99 доставки, устойчивость к обрывам |
| `ws-bench` (C, из блога Lemire) | потолок WebSocket-сервера |
| `autocannon` | HTTP/REST задержки |
| Chrome DevTools Performance | рендер, длинные задачи |
| `chrome://webrtc-internals` | RTT, jitter, packet loss звонка |
| Lighthouse | загрузка страницы |
| CDNPerf | TTFB по регионам |

### 6.2 Что собрать

1. **Наш стенд**: страница `bench/latency.html`, которая меряет:
   RTT до Supabase, INSERT, realtime-доставку, открытие чата, загрузку файла.
2. **Референс-релей**: минимальный сервер на uWebSockets.js (или Centrifugo)
   на той же машине. Сравнить с Supabase Realtime на одинаковой нагрузке.
3. **Референс-хранилище**: тот же Postgres локально vs Supabase по сети.
   Это покажет, сколько из 137 мс — сеть.
4. **SFU-референс**: LiveKit в Docker, сравнить задержку с P2P на реальных устройствах.
5. **CDN-референс**: один файл в R2, Bunny и Drive, замерить TTFB из Новосибирска.

### 6.3 Матрица замеров

- Устройства: ПК (Wi-Fi), телефон (Wi-Fi), телефон (LTE).
- Регионы: Новосибирск, Москва, Европа (через VPN).
- Метрики: p50 / p95 / p99, не среднее.
- Каждое изменение — отдельный замер, иначе не понять, что помогло.

---

## 7. Низкоуровневый язык: где имеет смысл

| Компонент | Язык | Выигрыш | Стоит ли |
|---|---|---|---|
| Браузерный клиент | JS/TS или Rust→WASM | почти нет для чата | Нет |
| WebSocket-шлюз | C++ (uWS) / Go | 2–8 µs на сообщение | Только при 10K+ соединений |
| Fanout | Rust/Go/Elixir | выше плотность | Нет при нашем масштабе |
| Хранилище | C++ (ScyllaDB) | миллионы записей/с | Нет, пока <1M сообщений |
| SFU (видео) | C++ (mediasoup/Janus) | ниже задержка и CPU | Да, если будут группы |
| E2EE | Rust (libsignal/openmls) | безопасность, не скорость | Да, если делать E2EE |
| Сжатие/парсинг | Rust/WASM | экономия CPU | Микрооптимизация |
| Push-отправка | Go/Rust в Edge Function | 3 с → 0.3 с | Да, но это не язык, а уход от Apps Script |

**Правило:** переписывать на низком уровне имеет смысл только то,
что реально грузит CPU при тысячах пользователей. У нас грузит сеть и Apps Script.

---

## 8. Итоговый порядок

1. Замерить текущий стек (раздел 6.2, пункт 1).
2. Сделать `SPEED.md`, этапы 1–2: кэш, один RPC, RLS-удаление.
3. Убрать Apps Script из файлов и push (Storage + Webhook).
4. Проверить регион Supabase; при необходимости — миграция.
5. Собрать референс-релей (uWS/Centrifugo) и сравнить. Если разница <10% —
   не переписывать ничего.
6. Только после этого думать про SFU, E2EE и низкоуровневый шлюз.

---

## 9. Источники

- Daniel Lemire, «WebSocket servers in JavaScript: Node.js, Bun and Deno in 2026», 10.10.2026 —
  https://lemire.me/blog/2026/10/10/websocket-servers-in-javascript-node-js-bun-and-deno-in-2026/
- AnyCable, «Socket.io vs uWS vs AnyCable», 2026 —
  https://anycable.io/compare/nodejs-websocket/
- http-arena (преемник TechEmpower) — https://http-arena.com/
- TechEmpower закрыт в марте 2026 —
  https://dev.to/nigrosimone/which-is-the-fastest-http-server-in-2026-eg5
- DB-Engines Ranking, ноябрь 2026 — https://db-engines.com/en/ranking
- ScyllaDB vs PostgreSQL vs Cassandra, бенчмарк 2026 —
  https://johal.in/performance-test-postgresql-19-vs-cassandra-vs-scylladb-performance/
- Discord: ScyllaDB, 72 ноды, p99 15 мс —
  https://blog.bytebytego.com/p/how-discord-stores-trillions-of-messages
- WhatsApp: 2M соединений на сервер (Erlang/FreeBSD) —
  https://blog.whatsapp.com/1-million-is-so-2011
- Telegram MTProto и дата-центры — https://core.telegram.org/techfaq
- SFU 2026: LiveKit / mediasoup / Janus —
  https://www.pistack.xyz/posts/2026-04-25-janus-gateway-vs-mediasoup-vs-livekit-self-hosted-webrtc-sfu-guide-2026/
- CDNPerf — https://www.cdnperf.com/
- Cloudflare Durable Objects, WebSocket —
  https://developers.cloudflare.com/durable-objects/best-practices/websockets/
