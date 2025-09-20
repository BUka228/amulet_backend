#!/usr/bin/env node

/**
 * Скрипт для создания дашбордов в Cloud Monitoring
 * 
 * Создает дашборды для:
 * - API Overview
 * - Business Metrics
 * - Notifications
 * - Devices & OTA
 */

import { DASHBOARD_CONFIGS } from '../core/sloConfig';

interface DashboardWidget {
  title: string;
  xyChart?: {
    dataSets: Array<{
      timeSeriesQuery: {
        timeSeriesFilter: {
          filter: string;
          aggregation: {
            alignmentPeriod: string;
            perSeriesAligner: string;
            crossSeriesReducer: string;
          };
        };
      };
    }>;
  };
  scorecard?: {
    timeSeriesQuery: {
      timeSeriesFilter: {
        filter: string;
        aggregation: {
          alignmentPeriod: string;
          perSeriesAligner: string;
          crossSeriesReducer: string;
        };
      };
    };
  };
}

interface Dashboard {
  displayName: string;
  mosaicLayout: {
    tiles: Array<{
      width: number;
      height: number;
      widget: DashboardWidget;
    }>;
  };
}

interface DashboardClient {
  createDashboard: (request: { parent: string; dashboard: Dashboard }) => Promise<[{ name: string }]>;
}

async function createDashboard(name: string, config: typeof DASHBOARD_CONFIGS.api_overview, client: DashboardClient) {
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) {
    throw new Error('GOOGLE_CLOUD_PROJECT not set');
  }

  const dashboard: Dashboard = {
    displayName: config.title,
    mosaicLayout: {
      tiles: [],
    },
  };

  // Создаем виджеты для каждой метрики
  config.metrics.forEach((metricType) => {
    const widget: DashboardWidget = {
      title: getMetricTitle(metricType),
    };

    if (metricType.includes('total') || metricType.includes('count')) {
      // Счетчики
      widget.scorecard = {
        timeSeriesQuery: {
          timeSeriesFilter: {
            filter: `metric.type="${metricType}"`,
            aggregation: {
              alignmentPeriod: '300s',
              perSeriesAligner: 'ALIGN_RATE',
              crossSeriesReducer: 'REDUCE_SUM',
            },
          },
        },
      };
    } else {
      // Графики
      widget.xyChart = {
        dataSets: [
          {
            timeSeriesQuery: {
              timeSeriesFilter: {
                filter: `metric.type="${metricType}"`,
                aggregation: {
                  alignmentPeriod: '60s',
                  perSeriesAligner: 'ALIGN_MEAN',
                  crossSeriesReducer: 'REDUCE_MEAN',
                },
              },
            },
          },
        ],
      };
    }

    dashboard.mosaicLayout.tiles.push({
      width: 6,
      height: 4,
      widget,
    });
  });

  try {
    const [result] = await client.createDashboard({
      parent: `projects/${projectId}`,
      dashboard,
    });
    console.log(`✅ Dashboard created: ${result.name}`);
    return result;
  } catch (error) {
    console.error(`❌ Failed to create dashboard ${name}:`, error);
    throw error;
  }
}

function getMetricTitle(metricType: string): string {
  const titles: Record<string, string> = {
    'custom.googleapis.com/amulet/http_requests_total': 'HTTP Requests',
    'custom.googleapis.com/amulet/http_request_duration': 'Request Duration',
    'custom.googleapis.com/amulet/errors_total': 'Errors',
    'custom.googleapis.com/amulet/business_users_active': 'Active Users',
    'custom.googleapis.com/amulet/business_devices_connected': 'Connected Devices',
    'custom.googleapis.com/amulet/business_hugs_sent': 'Hugs Sent',
    'custom.googleapis.com/amulet/business_practices_completed': 'Practices Completed',
    'custom.googleapis.com/amulet/notifications_sent_total': 'Notifications Sent',
    'custom.googleapis.com/amulet/fcm_delivery_latency': 'FCM Delivery Latency',
    'custom.googleapis.com/amulet/ota_updates_total': 'OTA Updates',
    'custom.googleapis.com/amulet/device_connection_status': 'Device Connection Status',
    'custom.googleapis.com/amulet/device_battery_level': 'Device Battery Level',
  };
  return titles[metricType] || metricType.split('.').pop() || 'Unknown Metric';
}

async function createAllDashboards() {
  console.log('🚀 Creating monitoring dashboards...');

  // Проверяем переменные окружения
  const projectId = process.env.GOOGLE_CLOUD_PROJECT || process.env.GCP_PROJECT;
  if (!projectId) {
    console.error('❌ GOOGLE_CLOUD_PROJECT environment variable is not set');
    console.log('Please set it with: export GOOGLE_CLOUD_PROJECT=your-project-id');
    process.exit(1);
  }

  console.log(`📋 Using project: ${projectId}`);

  try {
    // Динамический импорт клиента
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const monitoring = require('@google-cloud/monitoring');
    const client = new monitoring.DashboardsServiceClient();

    for (const [name, config] of Object.entries(DASHBOARD_CONFIGS)) {
      console.log(`📊 Creating dashboard: ${config.title}`);
      await createDashboard(name, config, client);
    }

    console.log('🎉 All dashboards created successfully!');
    console.log('\nNext steps:');
    console.log('1. Check Cloud Console > Monitoring > Dashboards');
    console.log('2. Customize dashboard layouts as needed');
    console.log('3. Set up automatic refresh intervals');
    console.log('4. Share dashboards with team members');

  } catch (error) {
    console.error('❌ Failed to create dashboards:', error);
    console.log('\nTroubleshooting:');
    console.log('1. Ensure you have the Monitoring Admin role');
    console.log('2. Check that the project ID is correct');
    console.log('3. Verify authentication: gcloud auth application-default login');
    process.exit(1);
  }
}

// Запускаем скрипт
if (require.main === module) {
  createAllDashboards();
}

export { createAllDashboards };
