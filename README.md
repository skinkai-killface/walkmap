# WalkMap 🚶🗺️

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Expo](https://img.shields.io/badge/Expo-SDK%2056-black?logo=expo)](https://expo.dev)
[![React Native](https://img.shields.io/badge/React%20Native-0.85-61dafb?logo=react)](https://reactnative.dev)
[![MapLibre](https://img.shields.io/badge/MapLibre-Native-blue?logo=maplibre)](https://maplibre.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-6.0-blue?logo=typescript)](https://www.typescriptlang.org/)

**WalkMap** — это современное, быстрое и ориентированное на приватность мобильное приложение для трекинга прогулок на React Native и Expo SDK 56 с векторными картами MapLibre и фоновой записью маршрута.

---

## ✨ Основные возможности

- 🗺️ **Векторные карты MapLibre**: Высокая производительность рендеринга тайлов OpenStreetMap с плавным зумом и вращением.
- 🛰️ **Фоновый GPS-трекинг**: Надежная запись маршрута в фоне с помощью Android Foreground Service — прогулка записывается даже с выключенным экраном.
- 📊 **Подробная аналитика**: Дистанция, время, текущий и средний темп, скорость, примерный расход калорий и график перепада высот.
- 🔥 **Серии и мотивация**: Ежедневные серии прогулок (streaks), постановка дневных целей, система достижений и наград.
- 📁 **Экспорт треков**: Экспорт любого записанного маршрута в форматы **GPX** и **GeoJSON** для просмотра в Strava, Komoot или GIS-софте.
- 🔒 **100% Приватность**: Все данные хранятся локально на устройстве (`AsyncStorage`). Никаких внешних серверов, телеметрии, рекламы или обязательной регистрации.
- 🎨 **Адаптивный интерфейс**: Плавные анимации, учет системных Safe Area Insets и динамическая смена светлой и тёмной тем.

---

## 🛠️ Стек технологий

- **Фреймворк**: [React Native 0.85](https://reactnative.dev) (React 19, New Architecture enabled)
- **Экосистема**: [Expo SDK 56](https://docs.expo.dev/) (Expo Router v56, Expo Location, Expo TaskManager)
- **Карты**: [@maplibre/maplibre-react-native](https://github.com/maplibre/maplibre-react-native)
- **Анимации**: [React Native Reanimated 4](https://docs.swmansion.com/react-native-reanimated/)
- **Язык**: TypeScript 6
- **Локальное хранилище**: `@react-native-async-storage/async-storage`

---

## 🚀 Быстрый старт

### Требования

- [Node.js](https://nodejs.org/) (версия 18+)
- [JDK 17](https://adoptium.net/)
- [Android Studio & Android SDK](https://developer.android.com/studio) (для сборки под Android)

### Установка зависимостей

```bash
git clone https://github.com/skinkai-killface/walkmap.git
cd walkmap
npm install
```

### Запуск в режиме разработки

Поскольку проект использует нативные модули MapLibre и службы фонового трекинга, запуск осуществляется через нативный dev-билд:

```bash
# Генерация нативных файлов и запуск на подключенном Android-устройстве или эмуляторе
npx expo run:android
```

---

## 📦 Сборка Release APK

Для создания готового release APK без использования облачных сервисов:

```bash
# 1. Генерация Android проекта (если папка android отсутствует)
npx expo prebuild --platform android

# 2. Компиляция Release APK
cd android
./gradlew assembleRelease
```

Собранный файл будет находиться по пути:
`android/app/build/outputs/apk/release/app-release.apk`

---

## 🔐 Разрешения (Android Permissions)

Приложению требуются следующие разрешения для полноценной работы:
- `ACCESS_FINE_LOCATION` и `ACCESS_COARSE_LOCATION` — точное определение геопозиции на карте.
- `ACCESS_BACKGROUND_LOCATION` — сохранение маршрута при свернутом приложении.
- `FOREGROUND_SERVICE` и `FOREGROUND_SERVICE_LOCATION` — непрерывная работа GPS-сервиса с уведомлением в статус-баре.
- `POST_NOTIFICATIONS` — отображение статуса активной прогулки.

---

## 📄 Лицензия

Проект распространяется под лицензией [MIT](LICENSE).
Автор: [skinkai-killface](https://github.com/skinkai-killface)
