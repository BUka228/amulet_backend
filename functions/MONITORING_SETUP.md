# Настройка мониторинга и алертов

Этот документ описывает, как настроить мониторинг и алерты для проекта Amulet.

## Предварительные требования

1. **Google Cloud Project** с включенным Cloud Monitoring API
2. **Аутентификация** в Google Cloud
3. **Права доступа** - роль "Monitoring Admin" или "Editor"

## Настройка

### 1. Установка переменных окружения

```bash
export GOOGLE_CLOUD_PROJECT=your-project-id
# или
export GCP_PROJECT=your-project-id
```

### 2. Аутентификация

```bash
# Аутентификация для приложения
gcloud auth application-default login

# Или для сервисного аккаунта
export GOOGLE_APPLICATION_CREDENTIALS=path/to/service-account-key.json
```

### 3. Включение API

```bash
# Включить Cloud Monitoring API
gcloud services enable monitoring.googleapis.com

# Включить Cloud Logging API (если нужно)
gcloud services enable logging.googleapis.com
```

## Использование скриптов

### Полная настройка мониторинга

```bash
# Запустить полную настройку (алерты + дашборды)
npm run setup:monitoring
```

### Отдельные скрипты

```bash
# Только создание дашбордов
npm run create:dashboards

# Только алерты (через monitoringService)
node -e "require('./dist/scripts/setupMonitoring').setupMonitoring()"
```

## Что создается

### Алерты

- **High Error Rate** - алерт при превышении порога ошибок
- **High Latency** - алерт при высокой латентности
- **Low Availability** - алерт при низкой доступности
- **SLO Alerts** - алерты для Service Level Objectives

### Дашборды

- **API Overview** - обзор API метрик
- **Business Metrics** - бизнес-метрики
- **Notifications** - метрики уведомлений
- **Devices & OTA** - метрики устройств и OTA обновлений

## Проверка результатов

1. **Cloud Console > Monitoring > Alerting** - проверьте созданные алерты
2. **Cloud Console > Monitoring > Dashboards** - проверьте созданные дашборды
3. **Cloud Console > Monitoring > Metrics** - проверьте отправку метрик

## Устранение неполадок

### Ошибка аутентификации

```bash
# Переустановите аутентификацию
gcloud auth application-default login
```

### Ошибка прав доступа

```bash
# Проверьте роли
gcloud projects get-iam-policy your-project-id

# Добавьте роль Monitoring Admin
gcloud projects add-iam-policy-binding your-project-id \
  --member="user:your-email@domain.com" \
  --role="roles/monitoring.admin"
```

### Ошибка API

```bash
# Включите необходимые API
gcloud services enable monitoring.googleapis.com
gcloud services enable logging.googleapis.com
```

## Структура мониторинга

### Метрики

- `custom.googleapis.com/amulet/http_requests_total` - HTTP запросы
- `custom.googleapis.com/amulet/http_request_duration` - длительность запросов
- `custom.googleapis.com/amulet/errors_total` - ошибки
- `custom.googleapis.com/amulet/business_*` - бизнес-метрики
- `custom.googleapis.com/amulet/notifications_*` - метрики уведомлений
- `custom.googleapis.com/amulet/ota_*` - метрики OTA обновлений

### Логи

- Структурированные логи с полями: `requestId`, `userId`, `route`, `latency`, `operation`, `resource`, `severity`, `metadata`
- Корреляция с трассировкой через `traceId`

### Трассировка

- Распределенная трассировка запросов
- Вложенные спаны для детального отслеживания
- Интеграция с Cloud Trace

## Настройка уведомлений

После создания алертов настройте каналы уведомлений:

1. **Cloud Console > Monitoring > Alerting > Notification Channels**
2. Добавьте каналы (email, Slack, PagerDuty, etc.)
3. Назначьте каналы к алерт-политикам

## Мониторинг в продакшене

- Убедитесь, что переменная `GOOGLE_CLOUD_PROJECT` установлена в продакшене
- Проверьте, что сервисный аккаунт имеет необходимые права
- Настройте автоматическое создание алертов при деплое

