/**
 * Глобальная очистка для остановки Firebase Emulator Suite
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { getEmulatorsAlreadyRunning } from './emulator-state';

const execAsync = promisify(exec);

export default async function globalTeardown() {
  console.log('🛑 Остановка Firebase Emulator Suite...');
  
  try {
    // Проверяем, были ли эмуляторы уже запущены до тестов
    // Если да, то не останавливаем их
    if (getEmulatorsAlreadyRunning()) {
      console.log('ℹ️  Эмуляторы были уже запущены до тестов, оставляем их работать');
      return;
    }

    // Убиваем процесс по PID, если файл существует
    const pidFile = path.join(__dirname, '../../.emulator.pid');
    if (fs.existsSync(pidFile)) {
      try {
        const pid = fs.readFileSync(pidFile, 'utf8').trim();
        process.kill(parseInt(pid), 'SIGTERM');
        fs.unlinkSync(pidFile);
        console.log(`✅ Процесс эмулятора ${pid} остановлен`);
      } catch (error) {
        console.log('Процесс эмулятора уже остановлен');
      }
    }

    // Пытаемся остановить эмуляторы через Firebase CLI
    try {
      await execAsync('firebase emulators:stop --project amulet-test');
      console.log('✅ Эмуляторы остановлены через Firebase CLI');
    } catch (error) {
      console.log('⚠️  Не удалось остановить эмуляторы через CLI, попытка принудительной остановки...');
      
      // Дополнительная очистка - убиваем все процессы firebase
      try {
        if (process.platform === 'win32') {
          await execAsync('taskkill /f /im firebase.exe');
        } else {
          await execAsync('pkill -f firebase');
        }
        console.log('✅ Процессы Firebase принудительно остановлены');
      } catch (killError) {
        console.log('⚠️  Не удалось принудительно остановить процессы Firebase');
      }
    }

    console.log('✅ Firebase Emulator Suite остановлен');
    
  } catch (error) {
    console.error('❌ Ошибка при остановке эмуляторов:', error);
    // Не выбрасываем ошибку, чтобы не блокировать завершение тестов
  }
}
