/**
 * Скрипт для создания начального контента в Firestore
 */

import { initializeApp } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { Practice, Pattern, PatternSpec } from '../types';

// Инициализация Firebase Admin
const app = initializeApp();
const db = getFirestore(app);

// Базовые практики
const practices: Omit<Practice, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    type: 'breath',
    title: 'Квадратное дыхание',
    description: 'Техника успокоения через равномерное дыхание',
    durationSec: 300,
    patternId: 'breath_square',
    audioUrl: 'https://storage.googleapis.com/amulet-audio/practices/square-breathing.mp3',
    locales: {
      'ru': {
        title: 'Квадратное дыхание',
        description: 'Техника успокоения через равномерное дыхание'
      },
      'en': {
        title: 'Square Breathing',
        description: 'Calming technique through even breathing'
      }
    },
    category: 'relaxation',
    difficulty: 'beginner',
    tags: ['breathing', 'calm', 'stress-relief'],
    isPublic: true,
    reviewStatus: 'approved',
    createdBy: 'system'
  },
  {
    type: 'breath',
    title: '4-7-8 Дыхание',
    description: 'Техника для быстрого засыпания и снятия тревоги',
    durationSec: 240,
    patternId: 'breath_478',
    audioUrl: 'https://storage.googleapis.com/amulet-audio/practices/478-breathing.mp3',
    locales: {
      'ru': {
        title: '4-7-8 Дыхание',
        description: 'Техника для быстрого засыпания и снятия тревоги'
      },
      'en': {
        title: '4-7-8 Breathing',
        description: 'Technique for quick sleep and anxiety relief'
      }
    },
    category: 'sleep',
    difficulty: 'beginner',
    tags: ['breathing', 'sleep', 'anxiety'],
    isPublic: true,
    reviewStatus: 'approved',
    createdBy: 'system'
  },
  {
    type: 'meditation',
    title: 'Медитация осознанности',
    description: '5-минутная практика присутствия в моменте',
    durationSec: 300,
    patternId: 'meditation_mindfulness',
    audioUrl: 'https://storage.googleapis.com/amulet-audio/practices/mindfulness.mp3',
    locales: {
      'ru': {
        title: 'Медитация осознанности',
        description: '5-минутная практика присутствия в моменте'
      },
      'en': {
        title: 'Mindfulness Meditation',
        description: '5-minute practice of being present in the moment'
      }
    },
    category: 'mindfulness',
    difficulty: 'beginner',
    tags: ['meditation', 'mindfulness', 'present'],
    isPublic: true,
    reviewStatus: 'approved',
    createdBy: 'system'
  },
  {
    type: 'sound',
    title: 'Звуки дождя',
    description: 'Расслабляющие звуки дождя для медитации',
    durationSec: 600,
    patternId: 'sound_rain',
    audioUrl: 'https://storage.googleapis.com/amulet-audio/practices/rain-sounds.mp3',
    locales: {
      'ru': {
        title: 'Звуки дождя',
        description: 'Расслабляющие звуки дождя для медитации'
      },
      'en': {
        title: 'Rain Sounds',
        description: 'Relaxing rain sounds for meditation'
      }
    },
    category: 'nature',
    difficulty: 'beginner',
    tags: ['nature', 'rain', 'relaxation'],
    isPublic: true,
    reviewStatus: 'approved',
    createdBy: 'system'
  }
];

// Базовые паттерны анимаций
const patterns: Omit<Pattern, 'id' | 'createdAt' | 'updatedAt'>[] = [
  {
    kind: 'light',
    spec: {
      type: 'breathing',
      hardwareVersion: 100,
      duration: 5000,
      loop: true,
      elements: [
        {
          type: 'pulse',
          startTime: 0,
          duration: 5000,
          color: '#00FF00',
          intensity: 0.8,
          speed: 1.0
        }
      ]
    } as PatternSpec,
    public: true,
    reviewStatus: 'approved',
    hardwareVersion: 100,
    title: 'Дыхание (v1.0)',
    description: 'Плавная пульсация для дыхательных практик',
    tags: ['breathing', 'calm', 'v1.0'],
    usageCount: 0,
    sharedWith: []
  },
  {
    kind: 'light',
    spec: {
      type: 'breathing',
      hardwareVersion: 200,
      duration: 5000,
      loop: true,
      elements: [
        {
          type: 'pulse',
          startTime: 0,
          duration: 5000,
          color: '#00FF00',
          intensity: 0.8,
          speed: 1.0,
          direction: 'center'
        }
      ]
    } as PatternSpec,
    public: true,
    reviewStatus: 'approved',
    hardwareVersion: 200,
    title: 'Дыхание (v2.0)',
    description: 'Плавная пульсация от центра для дыхательных практик',
    tags: ['breathing', 'calm', 'v2.0'],
    usageCount: 0,
    sharedWith: []
  },
  {
    kind: 'light',
    spec: {
      type: 'rainbow',
      hardwareVersion: 200,
      duration: 8000,
      loop: true,
      elements: [
        {
          type: 'gradient',
          startTime: 0,
          duration: 8000,
          colors: ['#FF0000', '#FF8000', '#FFFF00', '#00FF00', '#0080FF', '#8000FF'],
          intensity: 0.9,
          speed: 0.5,
          direction: 'clockwise'
        }
      ]
    } as PatternSpec,
    public: true,
    reviewStatus: 'approved',
    hardwareVersion: 200,
    title: 'Радуга (v2.0)',
    description: 'Плавный переход цветов по кольцу',
    tags: ['rainbow', 'colorful', 'v2.0'],
    usageCount: 0,
    sharedWith: []
  },
  {
    kind: 'haptic',
    spec: {
      type: 'pulse',
      hardwareVersion: 100,
      duration: 3000,
      loop: true,
      elements: [
        {
          type: 'pulse',
          startTime: 0,
          duration: 3000,
          intensity: 0.7,
          speed: 1.0
        }
      ]
    } as PatternSpec,
    public: true,
    reviewStatus: 'approved',
    hardwareVersion: 100,
    title: 'Вибрация успокоения',
    description: 'Мягкая пульсация для снятия стресса',
    tags: ['haptic', 'calm', 'stress-relief'],
    usageCount: 0,
    sharedWith: []
  },
  {
    kind: 'combo',
    spec: {
      type: 'custom',
      hardwareVersion: 200,
      duration: 10000,
      loop: true,
      elements: [
        {
          type: 'gradient',
          startTime: 0,
          duration: 10000,
          colors: ['#FF6B6B', '#4ECDC4', '#45B7D1'],
          intensity: 0.8,
          speed: 0.3,
          direction: 'counterclockwise'
        },
        {
          type: 'pulse',
          startTime: 0,
          duration: 10000,
          intensity: 0.6,
          speed: 0.8
        }
      ]
    } as PatternSpec,
    public: true,
    reviewStatus: 'approved',
    hardwareVersion: 200,
    title: 'Медитация света и вибрации',
    description: 'Комбинированный паттерн для глубокой медитации',
    tags: ['meditation', 'combo', 'v2.0'],
    usageCount: 0,
    sharedWith: []
  }
];

async function seedPractices() {
  console.log('🌱 Засеивание практик...');
  
  for (const practice of practices) {
    const docRef = db.collection('practices').doc();
    const now = Timestamp.now();
    
    await docRef.set({
      ...practice,
      id: docRef.id,
      createdAt: now,
      updatedAt: now
    });
    
    console.log(`✅ Практика создана: ${practice.title}`);
  }
}

async function seedPatterns() {
  console.log('🌱 Засеивание паттернов...');
  
  for (const pattern of patterns) {
    const docRef = db.collection('patterns').doc();
    const now = Timestamp.now();
    
    await docRef.set({
      ...pattern,
      id: docRef.id,
      createdAt: now,
      updatedAt: now
    });
    
    console.log(`✅ Паттерн создан: ${pattern.title}`);
  }
}

async function seedFirmware() {
  console.log('🌱 Засеивание прошивок...');
  
  const firmware = {
    version: '1.0.0',
    hardwareVersion: 100,
    downloadUrl: 'https://storage.googleapis.com/amulet-firmware/v1.0.0/firmware.bin',
    checksum: 'sha256:abc123...',
    size: 1024000,
    releaseNotes: 'Первая версия прошивки с базовым функционалом',
    locales: {
      'ru': {
        releaseNotes: 'Первая версия прошивки с базовым функционалом'
      },
      'en': {
        releaseNotes: 'First firmware version with basic functionality'
      }
    },
    isActive: true,
    rolloutPercentage: 100,
    publishedAt: Timestamp.now(),
    publishedBy: 'system'
  };
  
  const docRef = db.collection('firmware').doc();
  const now = Timestamp.now();
  
  await docRef.set({
    ...firmware,
    id: docRef.id,
    createdAt: now,
    updatedAt: now
  });
  
  console.log('✅ Прошивка создана: v1.0.0');
}

async function main() {
  try {
    console.log('🚀 Начинаем засеивание базы данных...');
    
    await seedPractices();
    await seedPatterns();
    await seedFirmware();
    
    console.log('🎉 Засеивание завершено успешно!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Ошибка при засеивании:', error);
    process.exit(1);
  }
}

// Запуск скрипта
if (require.main === module) {
  main();
}

export { seedPractices, seedPatterns, seedFirmware };
