export type HardwareVersion = 100 | 200;

export interface PatternSpecElement {
  type: string;
  startTime: number;
  duration: number;
  color?: string;
  colors?: string[];
  intensity?: number;
  speed?: number;
  direction?: 'clockwise' | 'counterclockwise' | 'center' | 'outward';
  leds?: number[];
}

export interface PatternSpec {
  type: 'breathing' | 'pulse' | 'rainbow' | 'fire' | 'gradient' | 'chase' | 'custom';
  hardwareVersion: HardwareVersion;
  duration: number;
  loop?: boolean;
  elements: PatternSpecElement[];
}

/**
 * Даун-левелинг паттерна с HW=200 до HW=100.
 * Упрощаем элементы: игнорируем leds и direction, сводим градиенты к первому цвету.
 */
export function downLevelPatternSpec(spec: PatternSpec, target: HardwareVersion): PatternSpec {
  if (spec.hardwareVersion === target) {
    return spec;
  }

  if (spec.hardwareVersion === 200 && target === 100) {
    const simplified: PatternSpec = {
      type: spec.type,
      hardwareVersion: 100,
      duration: spec.duration,
      loop: spec.loop,
      elements: spec.elements.map((el) => ({
        type: el.type,
        startTime: el.startTime,
        duration: el.duration,
        // Для градиента используем первый цвет, иначе берём одиночный цвет
        color: el.colors && el.colors.length > 0 ? el.colors[0] : el.color,
        intensity: el.intensity,
        speed: el.speed,
      })),
    };
    return simplified;
  }

  // Обратный ап-левел не выполняем автоматически; возвращаем исходный
  return spec;
}


