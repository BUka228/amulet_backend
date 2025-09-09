# Amulet API v1 (Firebase Backend)

Документ описывает продакшен API для мобильных приложений (iOS/Android) и веб-админки. Бэкенд основан на Firebase: Authentication, Firestore, Cloud Functions (HTTPS), Cloud Storage, Cloud Messaging (FCM), App Check, Hosting (админка), Remote Config.

## Общие принципы
- Версионирование: префикс `/v1` для HTTPS-ручек и коллекций в Firestore. Миграции — через новые версии.
- Аутентификация: Firebase Auth (Email/Password, Apple, Google). Все вызовы к защищённым ручкам требуют `Authorization: Bearer <Firebase ID Token>` и `X-App-Check`.
- Авторизация: через Firebase Security Rules + серверные проверки в Cloud Functions.
- Иденпотентность: для мутаций поддерживается заголовок `Idempotency-Key`.
- Локализация: заголовок `Accept-Language` (например, `ru-RU`), по умолчанию `en-US`.
- Ответы об ошибках: JSON с полями `code`, `message`, `details?`.
- Скоростные лимиты: 60 req/min для мобильных, 600 req/min для админки; усиленные лимиты на «объятия» и вебхуки.

## Аутентификация
- Регистрация/вход выполняются через Firebase SDK на клиенте.
- Обновление профиля и дополнительные проверки выполняются через API.

### Токены
- ID Token (1 час), Refresh Token (клиент обновляет через SDK).
- App Check токен обязателен для мобильных приложений.

## Ресурсы и модели (упрощённо)
- User: `users/{userId}`
  - `displayName`, `avatarUrl`, `timezone`, `language`, `consents`, `pushTokens[]`, `createdAt`, `updatedAt`
- Device: `devices/{deviceId}`
  - `ownerId`, `serial`, `hardwareVersion`, `firmwareVersion`, `name`, `batteryLevel`, `status`, `pairedAt`, `settings{brightness, haptics, gestures}`
- Session: `sessions/{sessionId}`
  - `ownerId`, `practiceId`, `deviceId`, `status{started|completed|aborted}`
  - `startedAt`, `endedAt`, `durationSec`, `userFeedback?{moodBefore, moodAfter}`, `source{manual|rule}`
- Pairing (связь пользователей): `pairs/{pairId}`
  - `memberIds[2]`, `status{active|pending|blocked}`, `createdAt`
- Hug (объятие): `hugs/{hugId}`
  - `fromUserId`, `toUserId`, `pairId`, `emotion{color, patternId}`, `payload?`, `inReplyToHugId?`, `deliveredAt?`, `createdAt`
- Practice: `practices/{practiceId}` (контент)
  - `type{breath|meditation|sound}`, `title`, `desc`, `durationSec`, `patternId`, `audioUrl?`, `locales{}`
- Pattern: `patterns/{patternId}`
  - `ownerId?` (если пользовательский), `kind{light|haptic|combo}`, `spec`, `public`, `reviewStatus`
- Rule (IFTTT): `rules/{ruleId}`
  - `ownerId`, `trigger{type, params}`, `action{type, params}`, `enabled`, `schedule?`
- Telemetry: `telemetry/{docId}` (агрегаты/сырые события по сабколлекциям)
- OTA: `firmware/{version}` метаданные и доступ из Storage

## HTTPS Endpoints (Cloud Functions)
База: `https://<region>-<project>.cloudfunctions.net/api` (или `https://api.amulet.app/v1` через прокси)

Все тела — JSON. Все ответы — JSON, кроме загрузки файлов (используется Storage).

### Пользователь
- POST /v1/users.me.init — Инициализация профиля после регистрации
  - body: `{ displayName?, timezone?, language?, consents? }`
  - 200: `{ user }`
- GET /v1/users.me — Получить профиль текущего пользователя
  - 200: `{ user }`
- PATCH /v1/users.me — Обновить профиль
  - body: `{ displayName?, avatarUrl?, timezone?, language?, consents? }`
  - 200: `{ user }`
- POST /v1/users.me/delete — Запрос на удаление аккаунта (асинхронно)
  - 202: `{ jobId }`

### Устройства
- POST /v1/devices.claim — Привязать устройство к аккаунту
  - body: `{ serial, claimToken, name? }`
  - 200: `{ device }`
- GET /v1/devices — Список устройств пользователя
  - 200: `{ devices: Device[] }`
- GET /v1/devices/:deviceId — Детали устройства
  - 200: `{ device }`
- PATCH /v1/devices/:deviceId — Обновить настройки
  - body: `{ name?, settings? }`
  - 200: `{ device }`
- POST /v1/devices/:deviceId/unclaim — Отвязать устройство
  - 200: `{ ok: true }`

### «Объятия» (Hugs)
- POST /v1/hugs.send — Отправить «объятие»
  - body: `{ toUserId?, pairId?, emotion: { color, patternId }, payload? }` (требуется указать хотя бы одно из `toUserId` или `pairId`)
  - 200: `{ hugId, delivered: boolean }`
- GET /v1/hugs — История с пагинацией
  - query: `direction?=sent|received`, `cursor?`, `limit?`
  - 200: `{ items: Hug[], nextCursor? }`
- GET /v1/hugs/:hugId — Детали
  - 200: `{ hug }`

### Пары (связи пользователей)
- POST /v1/pairs.invite — Пригласить партнёра
  - body: `{ method: link|qr|email, target? }`
  - 200: `{ inviteId, url }`
- POST /v1/pairs.accept — Принять приглашение
  - body: `{ inviteId }`
  - 200: `{ pair }`
- GET /v1/pairs — Список связей
  - 200: `{ pairs: Pair[] }`
- POST /v1/pairs/:pairId/block — Заблокировать
  - 200: `{ pair }`

### Библиотека практик и паттерны
- GET /v1/practices — Каталог (фильтры: тип, язык)
  - query: `type?`, `lang?`, `cursor?`, `limit?`
  - 200: `{ items: Practice[], nextCursor? }`
- GET /v1/practices/:practiceId — Детали
  - 200: `{ practice }`
- POST /v1/patterns — Создать пользовательский паттерн
  - body: `{ kind, spec, title?, public? }`
  - 201: `{ pattern }`
- GET /v1/patterns.mine — Мои паттерны
  - 200: `{ items: Pattern[] }`
- PATCH /v1/patterns/:patternId — Обновить
  - 200: `{ pattern }`
- DELETE /v1/patterns/:patternId — Удалить
  - 200: `{ ok: true }`

### Практики: выполнение и статистика
- POST /v1/practices/:practiceId/start — Старт сессии
  - body: `{ deviceId?, intensity?, brightness? }`
  - 200: `{ sessionId }`
- POST /v1/practices.session/:sessionId/stop — Остановка
  - body: `{ completed: boolean, durationSec? }`
  - 200: `{ summary }`
- GET /v1/stats/overview — Обзорная статистика
  - query: `range=day|week|month`
  - 200: `{ totals, streaks }`

### Интеграции и сценарии (IFTTT)
- GET /v1/rules — Список правил
  - 200: `{ items: Rule[] }`
- POST /v1/rules — Создать правило
  - body: `{ trigger, action, schedule?, enabled }`
  - 201: `{ rule }`
- PATCH /v1/rules/:ruleId — Обновить
  - 200: `{ rule }`
- DELETE /v1/rules/:ruleId — Удалить
  - 200: `{ ok: true }`
- POST /v1/webhooks/:integrationKey — Входящий вебхук триггера
  - public + signature: `X-Signature`
  - 202: `{ accepted: true }`

### Уведомления
- POST /v1/notifications.tokens — Зарегистрировать FCM-токен
  - body: `{ token, platform }`
  - 200: `{ ok: true }`
- DELETE /v1/notifications.tokens — Отвязать FCM-токен
  - body: `{ token }`
  - 200: `{ ok: true }`

### OTA / прошивки
- GET /v1/ota/firmware/latest?hardware=200&currentFirmware=205 — Проверка обновления
  - 200: `{ version, notes?, url, checksum }`
- POST /v1/devices/:deviceId/firmware/report — Отчёт об установке
  - body: `{ fromVersion, toVersion, status }`
  - 200: `{ ok: true }`

### Телеметрия (умеренно)
- POST /v1/telemetry/events — Пакет событий
  - body: `{ events: [{ type, ts, params }...] }`
  - 202: `{ accepted: n }`

### Админка (требует роль admin)
- GET /v1/admin/practices?status=pending — Модерация контента
- POST /v1/admin/practices — Создать/обновить контент
- POST /v1/admin/patterns/:id/review — Апрув/реджект пользовательского паттерна
- GET /v1/admin/devices?ownerId= — Поиск устройств
- POST /v1/admin/firmware — Публикация новой прошивки (метаданные)

## Firestore: основные коллекции и индексы
- `users` (поиск по email через Auth; в БД индекс по `displayName`, `language`)
- `devices` (индексы: `ownerId`, `serial` уникальный)
- `pairs` (составной индекс: `memberIds` array-contains, `status`)
- `hugs` (индексы: `fromUserId`, `toUserId`, `createdAt desc`, `inReplyToHugId`)
- `practices` (индексы: `type`, `locales.xx.title`)
- `patterns` (индексы: `ownerId`, `public`, `reviewStatus`)
- `rules` (индексы: `ownerId`, `enabled`)
- `sessions` (индексы: `ownerId`, `practiceId`, `status`, `startedAt desc`)

## Реалтайм-каналы
- FCM пуши:
  - `hug.received`, `pair.invite`, `practice.reminder`, `ota.available`

## Безопасность
- App Check для всех мобильных вызовов
- Security Rules с проверкой владения ресурсами (`ownerId == request.auth.uid`)
- Серверная проверка ролей (custom claims) для админки
- Подпись вебхуков SHA-256 (секрет интеграции), таймстемпы и реплей-защита
- Rate limiting и reCAPTCHA Enterprise для публичных форм (инвайты)

## Ошибки (формат)
```json
{
  "code": "invalid_argument",
  "message": "Missing field: serial",
  "details": { "field": "serial" }
}
```
Коды: `unauthenticated`, `permission_denied`, `not_found`, `invalid_argument`, `failed_precondition`, `already_exists`, `resource_exhausted`, `internal`, `unavailable`.

## Примеры запросов

### Отправка «объятия»
Запрос:
```http
POST /v1/hugs.send HTTP/1.1
Authorization: Bearer <ID_TOKEN>
Content-Type: application/json
Idempotency-Key: 7b9a...c12

{ "toUserId": "u_123", "emotion": { "color": "#FFD166", "patternId": "pat_warm" } }
```
Ответ:
```json
{ "hugId": "h_789", "delivered": true }
```

### Привязка устройства
```http
POST /v1/devices.claim
Authorization: Bearer <ID_TOKEN>
Content-Type: application/json

{ "serial": "AMU-200-XYZ-001", "claimToken": "nfc_otp_123", "name": "Мой амулет" }
```
Ответ: `{ "device": { ... } }`

## Хранилище (Storage)
- `avatars/{userId}/...` — пользовательские аватары
- `audio/practices/{practiceId}/...` — аудио треки
- `firmware/{hardwareVersion}/{semver}/...` — бинарники прошивок
Права доступа через Security Rules по путям и ролям.

## Производительность
- Агрессивное кеширование GET (ETag/If-None-Match) где возможно
- Сжатие ответов (gzip/br)
- Пакетные операции (например, события телеметрии)

## Наблюдаемость
- Структурированное логирование (requestId, userId, deviceId)
- Трассировки (Cloud Trace), метрики (Cloud Monitoring), алерты
  - Алертинг: настроить оповещения в Cloud Monitoring на аномальное количество 5xx от Cloud Functions, рост времени выполнения, ошибки доставки FCM и провалы OTA-отчётов.

## Декомпозиция функций (пример)
- `apiUsers` — users.me.*
- `apiDevices` — devices.*
- `apiHugs` — hugs.*
- `apiPairs` — pairs.*
- `apiLibrary` — practices/patterns
- `apiRules` — rules/webhooks
- `apiOta` — ota/firmware
- `apiTelemetry` — telemetry/events
- `adminUsers` — админ-операции над пользователями
- `adminContent` — модерация/публикация контента и паттернов
- `adminDevices` — управление устройствами и прошивками

## Миграции версий
- Ввод новых эндпоинтов под `/v2` без поломки существующих клиентов.
- Депрекация через заголовок `Deprecation` и Remote Config флажки.
