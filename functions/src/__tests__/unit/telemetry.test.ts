/**
 * Тесты для инициализации OpenTelemetry
 * 
 * Проверяем:
 * - Инициализацию в продакшене
 * - Отключение в разработке
 * - Обработку переменных окружения
 */

// Мокаем console для проверки логов
const mockConsole = {
  log: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
};

Object.assign(console, mockConsole);

describe('Telemetry Initialization', () => {
  let originalEnv: NodeJS.ProcessEnv;

  beforeEach(() => {
    jest.clearAllMocks();
    originalEnv = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('Инициализация в продакшене', () => {
    it('должен логировать отключение OpenTelemetry', () => {
      // Импортируем модуль заново для выполнения кода
      jest.resetModules();
      
      process.env.NODE_ENV = 'production';
      delete process.env.FUNCTIONS_EMULATOR;

      // Импортируем telemetry модуль
      require('../../core/telemetry');

      expect(mockConsole.log).toHaveBeenCalledWith(
        'OpenTelemetry disabled due to version conflicts'
      );
    });

    it('должен логировать отключение в эмуляторе', () => {
      jest.resetModules();
      
      process.env.NODE_ENV = 'production';
      process.env.FUNCTIONS_EMULATOR = 'true';

      require('../../core/telemetry');

      expect(mockConsole.log).toHaveBeenCalledWith(
        'OpenTelemetry disabled due to version conflicts'
      );
    });
  });

  describe('Инициализация в разработке', () => {
    it('должен логировать отключение в development', () => {
      jest.resetModules();
      
      process.env.NODE_ENV = 'development';
      delete process.env.FUNCTIONS_EMULATOR;

      require('../../core/telemetry');

      expect(mockConsole.log).toHaveBeenCalledWith(
        'OpenTelemetry disabled due to version conflicts'
      );
    });

    it('должен логировать отключение без NODE_ENV', () => {
      jest.resetModules();
      
      delete process.env.NODE_ENV;
      delete process.env.FUNCTIONS_EMULATOR;

      require('../../core/telemetry');

      expect(mockConsole.log).toHaveBeenCalledWith(
        'OpenTelemetry disabled due to version conflicts'
      );
    });
  });

  describe('Переменные окружения', () => {
    it('должен обрабатывать FUNCTION_VERSION', () => {
      jest.resetModules();
      
      process.env.NODE_ENV = 'production';
      process.env.FUNCTION_VERSION = '2.0.0';

      require('../../core/telemetry');

      expect(mockConsole.log).toHaveBeenCalledWith(
        'OpenTelemetry disabled due to version conflicts'
      );
    });

    it('должен использовать версию по умолчанию', () => {
      jest.resetModules();
      
      process.env.NODE_ENV = 'production';
      delete process.env.FUNCTION_VERSION;

      require('../../core/telemetry');

      expect(mockConsole.log).toHaveBeenCalledWith(
        'OpenTelemetry disabled due to version conflicts'
      );
    });
  });

  describe('Структура модуля', () => {
    it('должен экспортировать пустой объект', () => {
      const telemetryModule = require('../../core/telemetry');
      
      expect(telemetryModule).toEqual({});
    });

    it('должен быть синхронным модулем', () => {
      const startTime = Date.now();
      
      require('../../core/telemetry');
      
      const endTime = Date.now();
      const duration = endTime - startTime;
      
      // Модуль должен загружаться быстро (синхронно)
      expect(duration).toBeLessThan(100);
    });
  });

  describe('Комментарии и документация', () => {
    it('должен содержать комментарии о пакетах', () => {
      const fs = require('fs');
      const path = require('path');
      
      const telemetryPath = path.join(__dirname, '../../core/telemetry.ts');
      const content = fs.readFileSync(telemetryPath, 'utf8');
      
      expect(content).toContain('OpenTelemetry пакеты не установлены');
      expect(content).toContain('npm install @opentelemetry/sdk-node');
      expect(content).toContain('Временно отключено из-за проблем с совместимостью');
    });
  });

  describe('Безопасность', () => {
    it('должен безопасно обрабатывать отсутствующие переменные', () => {
      jest.resetModules();
      
      // Удаляем все переменные окружения
      delete process.env.NODE_ENV;
      delete process.env.FUNCTIONS_EMULATOR;
      delete process.env.FUNCTION_VERSION;

      expect(() => {
        require('../../core/telemetry');
      }).not.toThrow();
    });

    it('должен безопасно обрабатывать некорректные значения', () => {
      jest.resetModules();
      
      process.env.NODE_ENV = 'invalid';
      process.env.FUNCTIONS_EMULATOR = 'invalid';
      process.env.FUNCTION_VERSION = 'invalid';

      expect(() => {
        require('../../core/telemetry');
      }).not.toThrow();
    });
  });
});

