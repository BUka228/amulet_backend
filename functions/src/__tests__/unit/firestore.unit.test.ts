/**
 * Юнит-тесты для типов и моделей Firestore
 */

import {
  User,
  Device,
  Pair,
  Hug,
  Practice,
  PatternSpec,
  PatternElement,
  Rule,
  Session,
  TelemetryEvent,
  Firmware,
  Invite,
  NotificationToken,
  Webhook,
  AdminAction,
  Timestamp,
  BaseDocument
} from '../../types/firestore';

describe('Firestore Types', () => {
  const mockTimestamp: Timestamp = {
    seconds: 1640995200,
    nanoseconds: 0
  };

  const mockBaseDocument: BaseDocument = {
    id: 'test-id',
    createdAt: mockTimestamp,
    updatedAt: mockTimestamp
  };

  describe('BaseDocument', () => {
    it('should have required fields', () => {
      expect(mockBaseDocument.id).toBe('test-id');
      expect(mockBaseDocument.createdAt).toEqual(mockTimestamp);
      expect(mockBaseDocument.updatedAt).toEqual(mockTimestamp);
    });
  });

  describe('User', () => {
    const mockUser: User = {
      ...mockBaseDocument,
      consents: {
        analytics: true,
        marketing: false,
        telemetry: true
      },
      pushTokens: ['token1', 'token2'],
      isDeleted: false
    };

    it('should have all required fields', () => {
      expect(mockUser.consents.analytics).toBe(true);
      expect(mockUser.consents.marketing).toBe(false);
      expect(mockUser.consents.telemetry).toBe(true);
      expect(mockUser.pushTokens).toEqual(['token1', 'token2']);
      expect(mockUser.isDeleted).toBe(false);
    });

    it('should allow optional fields', () => {
      const userWithOptional: User = {
        ...mockUser,
        displayName: 'Test User',
        avatarUrl: 'https://example.com/avatar.jpg',
        timezone: 'Europe/Moscow',
        language: 'ru'
      };

      expect(userWithOptional.displayName).toBe('Test User');
      expect(userWithOptional.avatarUrl).toBe('https://example.com/avatar.jpg');
      expect(userWithOptional.timezone).toBe('Europe/Moscow');
      expect(userWithOptional.language).toBe('ru');
    });
  });

  describe('Device', () => {
    const mockDevice: Device = {
      ...mockBaseDocument,
      ownerId: 'user-123',
      serial: 'AMU-200-XYZ-001',
      hardwareVersion: 200,
      firmwareVersion: '2.0.0',
      name: 'Мой амулет',
      batteryLevel: 85,
      status: 'online',
      pairedAt: mockTimestamp,
      settings: {
        brightness: 80,
        haptics: 70,
        gestures: {
          singleTap: 'practice-1',
          doubleTap: 'practice-2',
          longPress: 'none'
        }
      },
      lastSeenAt: mockTimestamp
    };

    it('should have all required fields', () => {
      expect(mockDevice.ownerId).toBe('user-123');
      expect(mockDevice.serial).toBe('AMU-200-XYZ-001');
      expect(mockDevice.hardwareVersion).toBe(200);
      expect(mockDevice.firmwareVersion).toBe('2.0.0');
      expect(mockDevice.name).toBe('Мой амулет');
      expect(mockDevice.batteryLevel).toBe(85);
      expect(mockDevice.status).toBe('online');
    });

    it('should support different hardware versions', () => {
      const v1Device: Device = {
        ...mockDevice,
        hardwareVersion: 100,
        firmwareVersion: '1.0.0'
      };

      expect(v1Device.hardwareVersion).toBe(100);
      expect(v1Device.firmwareVersion).toBe('1.0.0');
    });

    it('should support different device statuses', () => {
      const statuses: Device['status'][] = ['online', 'offline', 'charging', 'error'];
      
      statuses.forEach(status => {
        const device: Device = { ...mockDevice, status };
        expect(device.status).toBe(status);
      });
    });
  });

  describe('Pair', () => {
    const mockPair: Pair = {
      ...mockBaseDocument,
      memberIds: ['user-1', 'user-2'],
      status: 'active',
      invitedBy: 'user-1',
      invitedAt: mockTimestamp,
      acceptedAt: mockTimestamp
    };

    it('should have exactly 2 member IDs', () => {
      expect(mockPair.memberIds).toHaveLength(2);
      expect(mockPair.memberIds[0]).toBe('user-1');
      expect(mockPair.memberIds[1]).toBe('user-2');
    });

    it('should support different pair statuses', () => {
      const statuses: Pair['status'][] = ['active', 'pending', 'blocked'];
      
      statuses.forEach(status => {
        const pair: Pair = { ...mockPair, status };
        expect(pair.status).toBe(status);
      });
    });
  });

  describe('Hug', () => {
    const mockHug: Hug = {
      ...mockBaseDocument,
      fromUserId: 'user-1',
      toUserId: 'user-2',
      pairId: 'pair-123',
      emotion: {
        color: '#FF6B6B',
        patternId: 'pattern-123'
      },
      payload: {
        message: 'Думаю о тебе!',
        customPattern: {
          type: 'breathing',
          hardwareVersion: 200,
          duration: 5000,
          loop: true,
          elements: []
        }
      },
      deliveredAt: mockTimestamp
    };

    it('should have all required fields', () => {
      expect(mockHug.fromUserId).toBe('user-1');
      expect(mockHug.toUserId).toBe('user-2');
      expect(mockHug.pairId).toBe('pair-123');
      expect(mockHug.emotion.color).toBe('#FF6B6B');
      expect(mockHug.emotion.patternId).toBe('pattern-123');
    });

    it('should support optional payload', () => {
      expect(mockHug.payload?.message).toBe('Думаю о тебе!');
      expect(mockHug.payload?.customPattern).toBeDefined();
    });
  });

  describe('Practice', () => {
    const mockPractice: Practice = {
      ...mockBaseDocument,
      type: 'breath',
      title: 'Квадратное дыхание',
      description: 'Техника успокоения',
      durationSec: 300,
      patternId: 'pattern-123',
      audioUrl: 'https://example.com/audio.mp3',
      locales: {
        'ru': {
          title: 'Квадратное дыхание',
          description: 'Техника успокоения'
        },
        'en': {
          title: 'Square Breathing',
          description: 'Calming technique'
        }
      },
      category: 'relaxation',
      difficulty: 'beginner',
      tags: ['breathing', 'calm'],
      isPublic: true,
      reviewStatus: 'approved',
      createdBy: 'system'
    };

    it('should support different practice types', () => {
      const types: Practice['type'][] = ['breath', 'meditation', 'sound'];
      
      types.forEach(type => {
        const practice: Practice = { ...mockPractice, type };
        expect(practice.type).toBe(type);
      });
    });

    it('should support different difficulty levels', () => {
      const difficulties: Practice['difficulty'][] = ['beginner', 'intermediate', 'advanced'];
      
      difficulties.forEach(difficulty => {
        const practice: Practice = { ...mockPractice, difficulty };
        expect(practice.difficulty).toBe(difficulty);
      });
    });

    it('should support different review statuses', () => {
      const statuses: Practice['reviewStatus'][] = ['pending', 'approved', 'rejected'];
      
      statuses.forEach(status => {
        const practice: Practice = { ...mockPractice, reviewStatus: status };
        expect(practice.reviewStatus).toBe(status);
      });
    });
  });

  describe('PatternSpec', () => {
    const mockPatternSpec: PatternSpec = {
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
    };

    it('should support different pattern types', () => {
      const types: PatternSpec['type'][] = [
        'breathing', 'pulse', 'rainbow', 'fire', 'gradient', 'chase', 'custom'
      ];
      
      types.forEach(type => {
        const spec: PatternSpec = { ...mockPatternSpec, type };
        expect(spec.type).toBe(type);
      });
    });

    it('should support different hardware versions', () => {
      const versions: PatternSpec['hardwareVersion'][] = [100, 200];
      
      versions.forEach(version => {
        const spec: PatternSpec = { ...mockPatternSpec, hardwareVersion: version };
        expect(spec.hardwareVersion).toBe(version);
      });
    });
  });

  describe('PatternElement', () => {
    const mockElement: PatternElement = {
      type: 'gradient',
      startTime: 0,
      duration: 2000,
      colors: ['#FF0000', '#00FF00', '#0000FF'],
      intensity: 0.9,
      speed: 1.5,
      direction: 'clockwise',
      leds: [0, 1, 2, 3]
    };

    it('should support different element types', () => {
      const types: PatternElement['type'][] = ['color', 'gradient', 'pulse', 'chase'];
      
      types.forEach(type => {
        const element: PatternElement = { ...mockElement, type };
        expect(element.type).toBe(type);
      });
    });

    it('should support different directions', () => {
      const directions: PatternElement['direction'][] = [
        'clockwise', 'counterclockwise', 'center', 'outward'
      ];
      
      directions.forEach(direction => {
        const element: PatternElement = { ...mockElement, direction };
        expect(element.direction).toBe(direction);
      });
    });
  });

  describe('Rule', () => {
    const mockRule: Rule = {
      ...mockBaseDocument,
      ownerId: 'user-123',
      trigger: {
        type: 'device_gesture',
        params: {
          gesture: 'doubleTap',
          deviceId: 'device-123'
        }
      },
      action: {
        type: 'start_practice',
        params: {
          practiceId: 'practice-123',
          intensity: 0.8
        }
      },
      enabled: true,
      schedule: {
        timezone: 'Europe/Moscow',
        cron: '0 9 * * *'
      },
      triggerCount: 5
    };

    it('should support different trigger types', () => {
      const triggerTypes: Rule['trigger']['type'][] = [
        'device_gesture', 'calendar', 'weather', 'geo', 'webhook', 'time'
      ];
      
      triggerTypes.forEach(type => {
        const rule: Rule = {
          ...mockRule,
          trigger: { ...mockRule.trigger, type }
        };
        expect(rule.trigger.type).toBe(type);
      });
    });

    it('should support different action types', () => {
      const actionTypes: Rule['action']['type'][] = [
        'start_practice', 'send_hug', 'light_device', 'smart_home', 'notification'
      ];
      
      actionTypes.forEach(type => {
        const rule: Rule = {
          ...mockRule,
          action: { ...mockRule.action, type }
        };
        expect(rule.action.type).toBe(type);
      });
    });
  });

  describe('Session', () => {
    const mockSession: Session = {
      ...mockBaseDocument,
      ownerId: 'user-123',
      practiceId: 'practice-123',
      deviceId: 'device-123',
      status: 'started',
      startedAt: mockTimestamp,
      source: 'manual',
      intensity: 0.8,
      brightness: 0.9
    };

    it('should support different session statuses', () => {
      const statuses: Session['status'][] = ['started', 'completed', 'aborted'];
      
      statuses.forEach(status => {
        const session: Session = { ...mockSession, status };
        expect(session.status).toBe(status);
      });
    });

    it('should support different sources', () => {
      const sources: Session['source'][] = ['manual', 'rule', 'reminder'];
      
      sources.forEach(source => {
        const session: Session = { ...mockSession, source };
        expect(session.source).toBe(source);
      });
    });

    it('should support user feedback', () => {
      const sessionWithFeedback: Session = {
        ...mockSession,
        status: 'completed',
        endedAt: mockTimestamp,
        durationSec: 300,
        userFeedback: {
          moodBefore: 3,
          moodAfter: 5,
          rating: 4,
          comment: 'Отличная практика!'
        }
      };

      expect(sessionWithFeedback.userFeedback?.moodBefore).toBe(3);
      expect(sessionWithFeedback.userFeedback?.moodAfter).toBe(5);
      expect(sessionWithFeedback.userFeedback?.rating).toBe(4);
      expect(sessionWithFeedback.userFeedback?.comment).toBe('Отличная практика!');
    });
  });

  describe('TelemetryEvent', () => {
    const mockTelemetryEvent: TelemetryEvent = {
      ...mockBaseDocument,
      userId: 'user-123',
      deviceId: 'device-123',
      type: 'session_started',
      timestamp: mockTimestamp,
      params: {
        practiceId: 'practice-123',
        intensity: 0.8,
        deviceBattery: 85
      },
      sessionId: 'session-123',
      practiceId: 'practice-123'
    };

    it('should support different parameter types', () => {
      const params = {
        stringParam: 'test',
        numberParam: 42,
        booleanParam: true,
        objectParam: { nested: 'value' }
      };

      const event: TelemetryEvent = {
        ...mockTelemetryEvent,
        params
      };

      expect(event.params.stringParam).toBe('test');
      expect(event.params.numberParam).toBe(42);
      expect(event.params.booleanParam).toBe(true);
      expect(event.params.objectParam).toEqual({ nested: 'value' });
    });
  });

  describe('Firmware', () => {
    const mockFirmware: Firmware = {
      ...mockBaseDocument,
      version: '2.0.0',
      hardwareVersion: 200,
      downloadUrl: 'https://example.com/firmware.bin',
      checksum: 'sha256:abc123...',
      size: 1024000,
      releaseNotes: 'Новая версия с улучшениями',
      locales: {
        'ru': {
          releaseNotes: 'Новая версия с улучшениями'
        },
        'en': {
          releaseNotes: 'New version with improvements'
        }
      },
      isActive: true,
      rolloutPercentage: 100,
      publishedAt: mockTimestamp,
      publishedBy: 'admin-123'
    };

    it('should support different rollout percentages', () => {
      const percentages = [0, 25, 50, 75, 100];
      
      percentages.forEach(percentage => {
        const firmware: Firmware = { ...mockFirmware, rolloutPercentage: percentage };
        expect(firmware.rolloutPercentage).toBe(percentage);
      });
    });

    it('should support version constraints', () => {
      const firmware: Firmware = {
        ...mockFirmware,
        minFirmwareVersion: '1.0.0',
        maxFirmwareVersion: '1.9.9'
      };

      expect(firmware.minFirmwareVersion).toBe('1.0.0');
      expect(firmware.maxFirmwareVersion).toBe('1.9.9');
    });
  });

  describe('Invite', () => {
    const mockInvite: Invite = {
      ...mockBaseDocument,
      fromUserId: 'user-1',
      method: 'link',
      target: 'user-2@example.com',
      inviteId: 'invite-123',
      expiresAt: mockTimestamp
    };

    it('should support different invite methods', () => {
      const methods: Invite['method'][] = ['link', 'qr', 'email'];
      
      methods.forEach(method => {
        const invite: Invite = { ...mockInvite, method };
        expect(invite.method).toBe(method);
      });
    });
  });

  describe('NotificationToken', () => {
    const mockToken: NotificationToken = {
      ...mockBaseDocument,
      userId: 'user-123',
      token: 'fcm-token-123',
      platform: 'ios',
      isActive: true,
      lastUsedAt: mockTimestamp
    };

    it('should support different platforms', () => {
      const platforms: NotificationToken['platform'][] = ['ios', 'android', 'web'];
      
      platforms.forEach(platform => {
        const token: NotificationToken = { ...mockToken, platform };
        expect(token.platform).toBe(platform);
      });
    });
  });

  describe('Webhook', () => {
    const mockWebhook: Webhook = {
      ...mockBaseDocument,
      integrationKey: 'webhook-123',
      secret: 'secret-key',
      isActive: true,
      usageCount: 42,
      allowedOrigins: ['https://example.com', 'https://app.example.com']
    };

    it('should support multiple allowed origins', () => {
      expect(mockWebhook.allowedOrigins).toHaveLength(2);
      expect(mockWebhook.allowedOrigins).toContain('https://example.com');
      expect(mockWebhook.allowedOrigins).toContain('https://app.example.com');
    });
  });

  describe('AdminAction', () => {
    const mockAdminAction: AdminAction = {
      ...mockBaseDocument,
      adminId: 'admin-123',
      action: 'approve_pattern',
      targetType: 'pattern',
      targetId: 'pattern-123',
      details: {
        patternId: 'pattern-123',
        reason: 'Meets quality standards'
      },
      reason: 'Approved for public use'
    };

    it('should support different target types', () => {
      const targetTypes: AdminAction['targetType'][] = [
        'user', 'device', 'pattern', 'practice', 'firmware'
      ];
      
      targetTypes.forEach(targetType => {
        const action: AdminAction = { ...mockAdminAction, targetType };
        expect(action.targetType).toBe(targetType);
      });
    });
  });
});
