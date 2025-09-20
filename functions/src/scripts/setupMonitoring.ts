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
import { createAllDashboards } from './createDashboards';

async function setupMonitoring() {
  console.log('🚀 Setting up monitoring and alerts...');

  // Проверяем переменные окружения
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) {
    console.error('❌ GOOGLE_CLOUD_PROJECT environment variable is not set');
    console.log('Please set it with: export GOOGLE_CLOUD_PROJECT=your-project-id');
    process.exit(1);
  }

  console.log(`📋 Using project: ${projectId}`);

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

    // Создаем дашборды
    console.log('📈 Creating dashboards...');
    await createAllDashboards();

    console.log('🎉 Monitoring setup completed successfully!');
    console.log('\nNext steps:');
    console.log('1. Check Cloud Console > Monitoring > Alerting');
    console.log('2. Check Cloud Console > Monitoring > Dashboards');
    console.log('3. Verify alert policies are active');
    console.log('4. Test alerts by triggering conditions');
    console.log('5. Set up notification channels (email, Slack, etc.)');

  } catch (error) {
    console.error('❌ Failed to setup monitoring:', error);
    console.log('\nTroubleshooting:');
    console.log('1. Ensure you have the Monitoring Admin role');
    console.log('2. Check that the project ID is correct');
    console.log('3. Verify authentication: gcloud auth application-default login');
    process.exit(1);
  }
}

// Запускаем скрипт
if (require.main === module) {
  setupMonitoring();
}

export { setupMonitoring };




