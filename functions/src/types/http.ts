/**
 * Типы для HTTP API
 */

import { Timestamp } from './firestore';

// Базовые типы ответов
export interface ApiResponse<T = unknown> {
  data?: T;
  error?: ApiError;
  meta?: {
    requestId: string;
    timestamp: Timestamp;
    version: string;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details?: Record<string, string | number | boolean>;
  field?: string;
}

// Коды ошибок
export type ErrorCode = 
  | 'unauthenticated'
  | 'permission_denied'
  | 'not_found'
  | 'invalid_argument'
  | 'failed_precondition'
  | 'already_exists'
  | 'resource_exhausted'
  | 'internal'
  | 'unavailable'
  | 'rate_limit_exceeded'
  | 'idempotency_key_conflict'
  | 'validation_failed'
  | 'quota_exceeded'
  | 'service_unavailable';

// Заголовки запросов
export interface RequestHeaders {
  'Authorization'?: string;
  'X-App-Check'?: string;
  'Idempotency-Key'?: string;
  'Accept-Language'?: string;
  'Content-Type'?: string;
  'If-None-Match'?: string;
  'X-Forwarded-For'?: string;
  'User-Agent'?: string;
}

// Middleware контекст
export interface RequestContext {
  requestId: string;
  userId?: string;
  deviceId?: string;
  ip: string;
  userAgent: string;
  language: string;
  timestamp: Timestamp;
  idempotencyKey?: string;
  appCheckToken?: string;
}

// Типы для пользователей
export interface CreateUserRequest {
  displayName?: string;
  timezone?: string;
  language?: string;
  consents?: {
    analytics?: boolean;
    marketing?: boolean;
    telemetry?: boolean;
  };
}

export interface UpdateUserRequest {
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  language?: string;
  consents?: {
    analytics?: boolean;
    marketing?: boolean;
    telemetry?: boolean;
  };
}

export interface DeleteUserRequest {
  reason?: string;
  feedback?: string;
}

export interface DeleteUserResponse {
  jobId: string;
  estimatedCompletionTime: Timestamp;
}

// Типы для устройств
export interface ClaimDeviceRequest {
  serial: string;
  claimToken: string;
  name?: string;
}

export interface UpdateDeviceRequest {
  name?: string;
  settings?: {
    brightness?: number;
    haptics?: number;
    gestures?: {
      singleTap?: string;
      doubleTap?: string;
      longPress?: string;
    };
  };
}

// Типы для объятий
export interface SendHugRequest {
  toUserId?: string;
  pairId?: string;
  emotion: {
    color: string;
    patternId: string;
  };
  payload?: {
    message?: string;
    customPattern?: object;
  };
}

export interface SendHugResponse {
  hugId: string;
  delivered: boolean;
}

export interface GetHugsRequest {
  direction?: 'sent' | 'received';
  cursor?: string;
  limit?: number;
}

// Типы для пар
export interface CreateInviteRequest {
  method: 'link' | 'qr' | 'email';
  target?: string;
}

export interface CreateInviteResponse {
  inviteId: string;
  url: string;
  qrCode?: string;
}

export interface AcceptInviteRequest {
  inviteId: string;
}

// Типы для практик
export interface GetPracticesRequest {
  type?: 'breath' | 'meditation' | 'sound';
  lang?: string;
  cursor?: string;
  limit?: number;
}

// Типы для паттернов
export interface CreatePatternRequest {
  kind: 'light' | 'haptic' | 'combo';
  spec: object;
  title?: string;
  description?: string;
  tags?: string[];
  public?: boolean;
  hardwareVersion: number;
}

export interface UpdatePatternRequest {
  title?: string;
  description?: string;
  tags?: string[];
  public?: boolean;
  spec?: object;
}

export interface SharePatternRequest {
  toUserId?: string;
  pairId?: string;
}

export interface PreviewPatternRequest {
  deviceId: string;
  spec: object;
  duration?: number;
}

export interface PreviewPatternResponse {
  previewId: string;
}

// Типы для сессий
export interface StartSessionRequest {
  deviceId?: string;
  intensity?: number;
  brightness?: number;
}

export interface StartSessionResponse {
  sessionId: string;
}

export interface StopSessionRequest {
  completed: boolean;
  durationSec?: number;
}

export interface StopSessionResponse {
  summary: {
    sessionId: string;
    durationSec: number;
    completed: boolean;
    practiceId: string;
    moodChange?: number;
  };
}

// Типы для статистики
export interface GetStatsRequest {
  range?: 'day' | 'week' | 'month';
}

// Типы для правил
export interface CreateRuleRequest {
  trigger: {
    type: 'device_gesture' | 'calendar' | 'weather' | 'geo' | 'webhook' | 'time';
    params: Record<string, string | number | boolean>;
  };
  action: {
    type: 'start_practice' | 'send_hug' | 'light_device' | 'smart_home' | 'notification';
    params: Record<string, string | number | boolean>;
  };
  schedule?: {
    timezone: string;
    cron: string;
  };
  enabled?: boolean;
}

export interface UpdateRuleRequest {
  trigger?: CreateRuleRequest['trigger'];
  action?: CreateRuleRequest['action'];
  schedule?: CreateRuleRequest['schedule'];
  enabled?: boolean;
}

// Типы для уведомлений
export interface RegisterTokenRequest {
  token: string;
  platform: 'ios' | 'android' | 'web';
}

export interface UnregisterTokenRequest {
  token: string;
}

// Типы для OTA
export interface GetFirmwareRequest {
  hardware: number;
  currentFirmware?: string;
}

export interface GetFirmwareResponse {
  version: string;
  notes?: string;
  url: string;
  checksum: string;
  size: number;
}

export interface ReportFirmwareRequest {
  fromVersion: string;
  toVersion: string;
  status: 'success' | 'failed' | 'cancelled';
  errorCode?: string;
  errorMessage?: string;
}

// Типы для телеметрии
export interface TelemetryEvent {
  type: string;
  ts: number;
  params: Record<string, string | number | boolean | object>;
}

export interface SendTelemetryRequest {
  events: TelemetryEvent[];
}

export interface SendTelemetryResponse {
  accepted: number;
  rejected?: number;
  errors?: Array<{
    index: number;
    error: string;
  }>;
}

// Типы для вебхуков
export interface WebhookRequest {
  integrationKey: string;
  signature: string;
  payload: object;
  timestamp: number;
}

// Типы для админки
export interface AdminGetPracticesRequest {
  status?: 'pending' | 'approved' | 'rejected';
  cursor?: string;
  limit?: number;
}

export interface AdminCreatePracticeRequest {
  type: 'breath' | 'meditation' | 'sound';
  title: string;
  description: string;
  durationSec: number;
  patternId: string;
  audioUrl?: string;
  locales: Record<string, {
    title: string;
    description: string;
  }>;
  category: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
  tags: string[];
  isPublic: boolean;
}

export interface AdminReviewPatternRequest {
  reviewStatus: 'approved' | 'rejected';
  reason?: string;
}

export interface AdminGetDevicesRequest {
  ownerId?: string;
  serial?: string;
  status?: string;
  cursor?: string;
  limit?: number;
}

export interface AdminPublishFirmwareRequest {
  version: string;
  hardwareVersion: number;
  downloadUrl: string;
  checksum: string;
  size: number;
  releaseNotes: string;
  locales: Record<string, {
    releaseNotes: string;
  }>;
  minFirmwareVersion?: string;
  maxFirmwareVersion?: string;
  rolloutPercentage?: number;
}

// Типы для rate limiting
export interface RateLimitInfo {
  limit: number;
  remaining: number;
  resetTime: Timestamp;
  retryAfter?: number;
}

// Типы для идемпотентности
export interface IdempotencyResponse {
  key: string;
  response: object;
  createdAt: Timestamp;
  expiresAt: Timestamp;
}

// Типы для валидации
export interface ValidationError {
  field: string;
  code: string;
  message: string;
  value?: string | number | boolean | object;
}

export interface ValidationResult {
  isValid: boolean;
  errors: ValidationError[];
}

// Типы для пагинации
export interface PaginationInfo {
  cursor?: string;
  limit: number;
  hasMore: boolean;
  totalCount?: number;
}

// Типы для фильтрации
export interface FilterInfo {
  hardwareVersion?: number;
  kind?: string;
  tags?: string[];
  status?: string;
  type?: string;
  language?: string;
  dateFrom?: Timestamp;
  dateTo?: Timestamp;
}

// Типы для сортировки
export interface SortInfo {
  field: string;
  direction: 'asc' | 'desc';
}

// Типы для поиска
export interface SearchRequest {
  query: string;
  filters?: FilterInfo;
  sort?: SortInfo;
  pagination?: PaginationInfo;
}

export interface SearchResponse<T> {
  items: T[];
  pagination: PaginationInfo;
  totalCount: number;
  searchTime: number;
}
