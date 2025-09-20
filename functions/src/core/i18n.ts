/**
 * Система интернационализации (i18n) для API
 * Поддерживает заголовок Accept-Language и возвращает локализованные сообщения
 */

import { Request } from 'express';

// Поддерживаемые языки
export type SupportedLanguage = 'en' | 'ru' | 'es' | 'fr' | 'de' | 'it' | 'pt' | 'ja' | 'ko' | 'zh';

// Язык по умолчанию
const DEFAULT_LANGUAGE: SupportedLanguage = 'en';

// Локализованные сообщения об ошибках
const MESSAGES: Record<SupportedLanguage, Record<string, string>> = {
  en: {
    // Аутентификация
    'auth.required': 'Authentication required',
    'auth.invalid_token': 'Invalid authentication token',
    'auth.token_expired': 'Authentication token has expired',
    'auth.permission_denied': 'Insufficient permissions',
    'auth.email_verification_required': 'Email verification required',
    
    // Пользователи
    'user.not_found': 'User profile not found',
    'user.already_deleted': 'User account is already deleted',
    'user.deletion_in_progress': 'Account deletion is already in progress',
    'user.profile_updated': 'Profile updated successfully',
    'user.deletion_requested': 'Account deletion request submitted. You will be notified when the process is complete.',
    
    // Устройства
    'device.not_found': 'Device not found',
    'device.already_claimed': 'Device is already claimed by another user',
    'device.invalid_claim_token': 'Invalid or expired claim token',
    'device.claim_success': 'Device claimed successfully',
    'device.unclaim_success': 'Device unclaimed successfully',
    
    // Объятия
    'hug.not_found': 'Hug not found',
    'hug.recipient_not_found': 'Recipient not found',
    'hug.sent_successfully': 'Hug sent successfully',
    'hug.delivery_failed': 'Failed to deliver hug',
    
    // Пары
    'pair.not_found': 'Pair not found',
    'pair.invite_not_found': 'Invitation not found',
    'pair.invite_expired': 'Invitation has expired',
    'pair.already_members': 'Users are already paired',
    'pair.invite_sent': 'Invitation sent successfully',
    'pair.invite_accepted': 'Invitation accepted successfully',
    'pair.blocked': 'Pair blocked successfully',
    
    // Практики и паттерны
    'practice.not_found': 'Practice not found',
    'pattern.not_found': 'Pattern not found',
    'pattern.invalid_spec': 'Invalid pattern specification',
    'pattern.creation_failed': 'Failed to create pattern',
    'pattern.update_failed': 'Failed to update pattern',
    'pattern.delete_failed': 'Failed to delete pattern',
    'pattern.share_failed': 'Failed to share pattern',
    
    // Сессии
    'session.not_found': 'Session not found',
    'session.already_started': 'Session already started',
    'session.already_ended': 'Session already ended',
    'session.start_failed': 'Failed to start session',
    'session.end_failed': 'Failed to end session',
    
    // Валидация
    'validation.required_field': 'Required field is missing',
    'validation.invalid_format': 'Invalid format',
    'validation.invalid_value': 'Invalid value',
    'validation.too_long': 'Value is too long',
    'validation.too_short': 'Value is too short',
    'validation.invalid_email': 'Invalid email format',
    'validation.invalid_url': 'Invalid URL format',
    
    // Общие ошибки
    'error.not_found': 'Resource not found',
    'error.invalid_argument': 'Invalid argument',
    'error.failed_precondition': 'Precondition failed',
    'error.already_exists': 'Resource already exists',
    'error.resource_exhausted': 'Resource limit exceeded',
    'error.internal': 'Internal server error',
    'error.unavailable': 'Service temporarily unavailable',
    'error.rate_limit_exceeded': 'Too many requests',
    'error.database_unavailable': 'Database temporarily unavailable. Please try again later.',
    'error.validation_failed': 'Validation failed',
    'error.idempotency_key_conflict': 'Idempotency key conflict',

    // Push notifications
    'push.hug.received.title': 'You received a hug',
    'push.hug.received.body': 'Open the app to feel it',
    'push.pair.invite.title': 'New connection request',
    'push.pair.invite.body': 'Someone wants to connect with you',
    'push.practice.reminder.title': 'Time for your practice',
    'push.practice.reminder.body': 'Take a moment to breathe and center yourself',
    'push.ota.available.title': 'Firmware update available',
    'push.ota.available.body': 'Your Amulet has a new update ready',
  },
  
  ru: {
    // Аутентификация
    'auth.required': 'Требуется аутентификация',
    'auth.invalid_token': 'Недействительный токен аутентификации',
    'auth.token_expired': 'Токен аутентификации истек',
    'auth.permission_denied': 'Недостаточно прав доступа',
    'auth.email_verification_required': 'Требуется подтверждение email',
    
    // Пользователи
    'user.not_found': 'Профиль пользователя не найден',
    'user.already_deleted': 'Аккаунт пользователя уже удален',
    'user.deletion_in_progress': 'Удаление аккаунта уже выполняется',
    'user.profile_updated': 'Профиль успешно обновлен',
    'user.deletion_requested': 'Запрос на удаление аккаунта отправлен. Вы будете уведомлены по завершении процесса.',
    
    // Устройства
    'device.not_found': 'Устройство не найдено',
    'device.already_claimed': 'Устройство уже привязано к другому пользователю',
    'device.invalid_claim_token': 'Недействительный или истекший токен привязки',
    'device.claim_success': 'Устройство успешно привязано',
    'device.unclaim_success': 'Устройство успешно отвязано',
    
    // Объятия
    'hug.not_found': 'Объятие не найдено',
    'hug.recipient_not_found': 'Получатель не найден',
    'hug.sent_successfully': 'Объятие успешно отправлено',
    'hug.delivery_failed': 'Не удалось доставить объятие',
    
    // Пары
    'pair.not_found': 'Связь не найдена',
    'pair.invite_not_found': 'Приглашение не найдено',
    'pair.invite_expired': 'Приглашение истекло',
    'pair.already_members': 'Пользователи уже связаны',
    'pair.invite_sent': 'Приглашение успешно отправлено',
    'pair.invite_accepted': 'Приглашение успешно принято',
    'pair.blocked': 'Связь успешно заблокирована',
    
    // Практики и паттерны
    'practice.not_found': 'Практика не найдена',
    'pattern.not_found': 'Паттерн не найден',
    'pattern.invalid_spec': 'Недействительная спецификация паттерна',
    'pattern.creation_failed': 'Не удалось создать паттерн',
    'pattern.update_failed': 'Не удалось обновить паттерн',
    'pattern.delete_failed': 'Не удалось удалить паттерн',
    'pattern.share_failed': 'Не удалось поделиться паттерном',
    
    // Сессии
    'session.not_found': 'Сессия не найдена',
    'session.already_started': 'Сессия уже начата',
    'session.already_ended': 'Сессия уже завершена',
    'session.start_failed': 'Не удалось начать сессию',
    'session.end_failed': 'Не удалось завершить сессию',
    
    // Валидация
    'validation.required_field': 'Обязательное поле отсутствует',
    'validation.invalid_format': 'Неверный формат',
    'validation.invalid_value': 'Неверное значение',
    'validation.too_long': 'Значение слишком длинное',
    'validation.too_short': 'Значение слишком короткое',
    'validation.invalid_email': 'Неверный формат email',
    'validation.invalid_url': 'Неверный формат URL',
    
    // Общие ошибки
    'error.not_found': 'Ресурс не найден',
    'error.invalid_argument': 'Неверный аргумент',
    'error.failed_precondition': 'Предварительное условие не выполнено',
    'error.already_exists': 'Ресурс уже существует',
    'error.resource_exhausted': 'Превышен лимит ресурсов',
    'error.internal': 'Внутренняя ошибка сервера',
    'error.unavailable': 'Сервис временно недоступен',
    'error.rate_limit_exceeded': 'Слишком много запросов',
    'error.database_unavailable': 'База данных временно недоступна. Попробуйте позже.',
    'error.validation_failed': 'Ошибка валидации',
    'error.idempotency_key_conflict': 'Конфликт ключа идемпотентности',

    // Push notifications
    'push.hug.received.title': 'Вы получили объятие',
    'push.hug.received.body': 'Откройте приложение, чтобы почувствовать его',
    'push.pair.invite.title': 'Новый запрос на связь',
    'push.pair.invite.body': 'Кто-то хочет подключиться к вам',
    'push.practice.reminder.title': 'Время для практики',
    'push.practice.reminder.body': 'Найдите момент, чтобы подышать и сосредоточиться',
    'push.ota.available.title': 'Доступно обновление прошивки',
    'push.ota.available.body': 'Ваш Амулет готов к обновлению',
  },
  
  // Заглушки для других языков (можно расширить)
  es: {},
  fr: {},
  de: {},
  it: {},
  pt: {},
  ja: {},
  ko: {},
  zh: {},
};

/**
 * Извлекает язык из заголовка Accept-Language
 */
export function getLanguageFromRequest(req: Request): SupportedLanguage {
  const acceptLanguage = req.headers['accept-language'];
  
  if (!acceptLanguage) {
    return DEFAULT_LANGUAGE;
  }

  // Парсим заголовок Accept-Language
  // Формат: "en-US,en;q=0.9,ru;q=0.8"
  const languages = acceptLanguage
    .split(',')
    .map((lang) => {
      const [locale, qValue] = lang.trim().split(';q=');
      const quality = qValue ? parseFloat(qValue) : 1.0;
      return { locale: locale.trim(), quality };
    })
    .sort((a, b) => b.quality - a.quality);

  // Ищем первый поддерживаемый язык
  for (const { locale } of languages) {
    // Извлекаем основной язык (en из en-US)
    const mainLang = locale.split('-')[0].toLowerCase() as SupportedLanguage;
    
    if (MESSAGES[mainLang] && Object.keys(MESSAGES[mainLang]).length > 0) {
      return mainLang;
    }
  }

  return DEFAULT_LANGUAGE;
}

/**
 * Получает локализованное сообщение
 */
export function getMessage(req: Request, key: string, fallback?: string): string {
  const language = getLanguageFromRequest(req);
  const messages = MESSAGES[language];
  
  // Если сообщение найдено в текущем языке
  if (messages[key]) {
    return messages[key];
  }
  
  // Fallback на английский
  if (language !== 'en' && MESSAGES.en[key]) {
    return MESSAGES.en[key];
  }
  
  // Fallback на переданное значение
  if (fallback) {
    return fallback;
  }
  
  // Последний fallback - сам ключ
  return key;
}

/**
 * Получает локализованное сообщение об ошибке
 */
export function getErrorMessage(req: Request, key: string, fallback?: string): string {
  return getMessage(req, key, fallback);
}

/**
 * Middleware для добавления языка в контекст запроса
 */
export function i18nMiddleware() {
  return (req: Request, res: unknown, next: () => void) => {
    req.language = getLanguageFromRequest(req);
    next();
  };
}

// Расширяем типы Express для добавления языка
declare global {
  namespace Express {
    interface Request {
      language?: SupportedLanguage;
    }
  }
}
