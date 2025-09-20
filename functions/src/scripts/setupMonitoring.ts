#!/usr/bin/env node

/**
 * Скрипт для настройки мониторинга и алертов
 * 
 * Выполняет:
 * - Создание алерт политик
 * - Настройку SLO алертов
 * - Создание дашбордов (если поддерживается)
 * - Настройку фильтров логов
 */

import { monitoringService } from '../core/monitoring';
import { SLO_CONFIGS, ALERT_POLICIES } from '../core/sloConfig';

async function setupMonitoring() {
  console.log('🚀 Setting up monitoring and alerts...');

  try {
    // Создаем SLO алерты
    console.log('📊 Creating SLO alerts...');
    await monitoringService.createSLOAlerts(SLO_CONFIGS);
    console.log('✅ SLO alerts created');

    // Создаем алерт политики
    console.log('🚨 Creating alert policies...');
    for (const policy of ALERT_POLICIES) {
      await monitoringService.createAlertPolicy(policy);
      console.log(`✅ Alert policy created: ${policy.displayName}`);
    }

    console.log('🎉 Monitoring setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Check Cloud Console > Monitoring > Alerting');
    console.log('2. Verify alert policies are active');
    console.log('3. Test alerts by triggering conditions');
    console.log('4. Set up notification channels (email, Slack, etc.)');

  } catch (error) {
    console.error('❌ Failed to setup monitoring:', error);
    process.exit(1);
  }
}

// Запускаем скрипт
if (require.main === module) {
  setupMonitoring();
}

export { setupMonitoring };




