# НКСЭ — Android-приложение

Оболочка на **Rust + Tauri 2**, внутри — тот же сайт (WebView): все вкладки,
темы, анимации и стиль один в один. Rust отвечает за нативное приложение,
офлайн-режим и будущие обновления.

## Что уже есть

- Полный layout сайта: меню, расписание, библиотека, пожелания, мессенджер.
- Камера в экране: Android-слой отдаёт вырез по всем четырём сторонам
  (`--nkse-cutout-top/left/right/bottom`), страница пересчитывает отступы при
  повороте и складывании. Шапка продлевается под камеру, текст остаётся ниже
  неё. Белая рамка сайта вокруг `body` в тёмной теме убрана — край экрана
  чистый, фон доходит до скруглённых углов.
- Офлайн-индикатор слева сверху: «Офлайн · данные от …».
- Виджет на рабочий стол: текущая/следующая пара, кабинет, ещё 2 пары,
  офлайн-кэш и обновление раз в 30 минут.
- Расписание кэшируется в WebView (localStorage + service worker), поэтому
  при отсутствии сети открывается последняя загруженная таблица.
- Онлайн-данные тянутся с GitHub Pages, как на сайте.
- Тёмная/светлая темы, все пресеты, настройки, звук, шрифты — как на сайте.

## Сборка APK

Нужны:

- JDK 17
- Android SDK (platform 34, build-tools 34.0.0)
- Android NDK 26.1.10909125
- Rust-таргеты `aarch64-linux-android` и др.
- На Windows без Visual Studio используем GNU-тулчейн:
  `RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu`

```powershell
cd mobile
npm install
node scripts/prepare-frontend.mjs
$env:JAVA_HOME='C:\Program Files\Microsoft\jdk-17.0.21.21-hotspot'
$env:ANDROID_HOME="$env:LOCALAPPDATA\Android\Sdk"
$env:NDK_HOME="$env:ANDROID_HOME\ndk\26.1.10909125"
$env:RUSTUP_TOOLCHAIN='stable-x86_64-pc-windows-gnu'
npx tauri android build --apk --debug --target aarch64 --ci
```

APK появится в:

```
src-tauri/gen/android/app/build/outputs/apk/universal/debug/app-universal-debug.apk
```

## Обновления

- Расписание обновляется само с GitHub, без переустановки приложения.
- Новые вкладки/интерфейс — новым APK (дальше добавим проверку обновлений
  через манифест и ссылку на APK).

## Структура

```
mobile/
  scripts/prepare-frontend.mjs   копия сайта + офлайн-индикатор
  app-frontend/                  сгенерированный фронтенд (не коммитится)
  src-tauri/                     Rust-оболочка и Android-проект
```
