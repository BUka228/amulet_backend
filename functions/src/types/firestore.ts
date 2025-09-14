/**
 * Типы для коллекций Firestore
 */

// Базовые типы
export interface Timestamp {
  seconds: number;
  nanoseconds: number;
}

export interface BaseDocument {
  id: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

// User Collection
export interface User extends BaseDocument {
  displayName?: string;
  avatarUrl?: string;
  timezone?: string;
  language?: string;
  consents: {
    analytics: boolean;
    marketing: boolean;
    telemetry: boolean;
  };
  pushTokens: string[];
  isDeleted: boolean;
  deletedAt?: Timestamp;
}

// Device Collection
export interface Device extends BaseDocument {
  ownerId: string;
  serial: string;
  hardwareVersion: number; // 100 для v1.0, 200 для v2.0
  firmwareVersion: string;
  name: string;
  batteryLevel: number; // 0-100
  status: 'online' | 'offline' | 'charging' | 'error';
  pairedAt: Timestamp;
  settings: {
    brightness: number; // 0-100
    haptics: number; // 0-100
    gestures: {
      singleTap: string; // practiceId или 'none'
      doubleTap: string; // practiceId или 'none'
      longPress: string; // practiceId или 'none'
    };
  };
  lastSeenAt: Timestamp;
}

// Pair Collection (связи пользователей)
export interface Pair extends BaseDocument {
  memberIds: [string, string]; // всегда ровно 2 элемента
  status: 'active' | 'pending' | 'blocked';
  invitedBy: string;
  invitedAt: Timestamp;
  acceptedAt?: Timestamp;
  blockedBy?: string;
  blockedAt?: Timestamp;
}

// Hug Collection (объятия)
export interface Hug extends BaseDocument {
  fromUserId: string;
  toUserId: string;
  pairId?: string;
  emotion: {
    color: string; // hex color
    patternId: string;
  };
  payload?: {
    message?: string;
    customPattern?: PatternSpec;
  };
  inReplyToHugId?: string;
  deliveredAt?: Timestamp;
  readAt?: Timestamp;
}

// Practice Collection (контент)
export interface Practice extends BaseDocument {
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
  reviewStatus: 'pending' | 'approved' | 'rejected';
  createdBy?: string; // для пользовательских практик
}

// Pattern Collection (анимации)
export interface Pattern extends BaseDocument {
  ownerId?: string; // если пользовательский
  kind: 'light' | 'haptic' | 'combo';
  spec: PatternSpec;
  public: boolean;
  reviewStatus: 'pending' | 'approved' | 'rejected';
  hardwareVersion: number; // 100 или 200
  title: string;
  description: string;
  tags: string[];
  usageCount: number; // для статистики
  sharedWith: string[]; // userIds
}

// Спецификация паттерна анимации
export interface PatternSpec {
  type: 'breathing' | 'pulse' | 'rainbow' | 'fire' | 'gradient' | 'chase' | 'custom';
  hardwareVersion: 100 | 200;
  duration: number; // в миллисекундах
  loop: boolean;
  elements: PatternElement[];
}

export interface PatternElement {
  type: 'color' | 'gradient' | 'pulse' | 'chase';
  startTime: number; // в миллисекундах от начала
  duration: number; // в миллисекундах
  color?: string; // hex color для type: 'color'
  colors?: string[]; // hex colors для type: 'gradient'
  intensity: number; // 0-1
  speed: number; // множитель скорости
  direction?: 'clockwise' | 'counterclockwise' | 'center' | 'outward';
  leds?: number[]; // индексы светодиодов для v2.0
}

// Rule Collection (IFTTT правила)
export interface Rule extends BaseDocument {
  ownerId: string;
  trigger: {
    type: 'device_gesture' | 'calendar' | 'weather' | 'geo' | 'webhook' | 'time';
    params: Record<string, string | number | boolean>;
  };
  action: {
    type: 'start_practice' | 'send_hug' | 'light_device' | 'smart_home' | 'notification';
    params: Record<string, string | number | boolean>;
  };
  enabled: boolean;
  schedule?: {
    timezone: string;
    cron: string; // cron expression
  };
  lastTriggeredAt?: Timestamp;
  triggerCount: number;
}

// Session Collection (сессии практик)
export interface Session extends BaseDocument {
  ownerId: string;
  practiceId: string;
  deviceId?: string;
  status: 'started' | 'completed' | 'aborted';
  startedAt: Timestamp;
  endedAt?: Timestamp;
  durationSec?: number;
  userFeedback?: {
    moodBefore: number; // 1-5
    moodAfter: number; // 1-5
    rating: number; // 1-5
    comment?: string;
  };
  source: 'manual' | 'rule' | 'reminder';
  intensity?: number; // 0-1
  brightness?: number; // 0-1
}

// Telemetry Collection (аналитика)
export interface TelemetryEvent extends BaseDocument {
  userId: string;
  deviceId?: string;
  type: string;
  timestamp: Timestamp;
  params: Record<string, string | number | boolean | object>;
  sessionId?: string;
  practiceId?: string;
}

export interface TelemetryAggregate extends BaseDocument {
  userId: string;
  date: string; // YYYY-MM-DD
  metrics: {
    sessionsCount: number;
    totalDurationSec: number;
    practicesCompleted: number;
    hugsSent: number;
    hugsReceived: number;
    patternsCreated: number;
    rulesTriggered: number;
  };
}

// Firmware Collection (OTA)
export interface Firmware extends BaseDocument {
  version: string; // semver
  hardwareVersion: number;
  downloadUrl: string;
  checksum: string;
  size: number; // в байтах
  releaseNotes: string;
  locales: Record<string, {
    releaseNotes: string;
  }>;
  isActive: boolean;
  minFirmwareVersion?: string; // минимальная версия для обновления
  maxFirmwareVersion?: string; // максимальная версия для обновления
  rolloutPercentage: number; // 0-100
  publishedAt: Timestamp;
  publishedBy: string; // admin userId
}

// Invite Collection (приглашения в пары)
export interface Invite extends BaseDocument {
  fromUserId: string;
  method: 'link' | 'qr' | 'email';
  target?: string; // email или userId
  inviteId: string; // уникальный идентификатор
  expiresAt: Timestamp;
  acceptedAt?: Timestamp;
  acceptedBy?: string;
  pairId?: string; // созданная пара
}

// Notification Token Collection (FCM)
export interface NotificationToken extends BaseDocument {
  userId: string;
  token: string;
  platform: 'ios' | 'android' | 'web';
  isActive: boolean;
  lastUsedAt: Timestamp;
}

// Webhook Collection (интеграции)
export interface Webhook extends BaseDocument {
  integrationKey: string;
  secret: string;
  isActive: boolean;
  lastUsedAt?: Timestamp;
  usageCount: number;
  allowedOrigins: string[];
}

// Admin Collections
export interface AdminAction extends BaseDocument {
  adminId: string;
  action: string;
  targetType: 'user' | 'device' | 'pattern' | 'practice' | 'firmware';
  targetId: string;
  details: Record<string, string | number | boolean | object>;
  reason?: string;
}

// Indexes для Firestore
export interface FirestoreIndex {
  collectionGroup: string;
  queryScope: 'COLLECTION' | 'COLLECTION_GROUP';
  fields: Array<{
    fieldPath: string;
    order: 'ASCENDING' | 'DESCENDING';
  }>;
}

// Типы для API запросов
export interface PaginationParams {
  cursor?: string;
  limit?: number;
}

export interface PaginatedResponse<T> {
  items: T[];
  nextCursor?: string;
  hasMore: boolean;
}

export interface FilterParams {
  hardwareVersion?: number;
  kind?: string;
  tags?: string[];
  status?: string;
  type?: string;
  language?: string;
}

// Типы для статистики
export interface StatsOverview {
  totals: {
    sessionsCount: number;
    totalDurationSec: number;
    practicesCompleted: number;
    hugsSent: number;
    hugsReceived: number;
    patternsCreated: number;
    rulesTriggered: number;
  };
  streaks: {
    current: number;
    longest: number;
    lastActivity: Timestamp;
  };
  range: 'day' | 'week' | 'month';
}
