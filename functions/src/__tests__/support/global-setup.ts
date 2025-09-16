/**
 * Глобальная настройка для запуска Firebase Emulator Suite
 */

import { spawn } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { setEmulatorsAlreadyRunning } from './emulator-state';

const exec = promisify(require('child_process').exec);

let emulatorProcess: any;

// Функция для проверки доступности порта
const isPortAvailable = (port: number): Promise<boolean> => {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.once('close', () => resolve(true));
      server.close();
    });
    server.on('error', () => resolve(false));
  });
};

// Функция для проверки, запущены ли эмуляторы
const checkEmulatorsRunning = async (): Promise<boolean> => {
  const ports = [8080, 9099, 9199, 5001]; // Firestore, Auth, Storage, Functions
  const results = await Promise.all(ports.map(port => isPortAvailable(port)));
  return results.some(available => !available); // Если хотя бы один порт занят
};

// Функция для проверки доступности эмуляторов
const checkEmulatorsHealth = async (): Promise<boolean> => {
  try {
    const response = await fetch('http://localhost:8080');
    return response.ok;
  } catch {
    return false;
  }
};

// Функция для остановки старых эмуляторов
const stopOldEmulators = async (): Promise<void> => {
  try {
    console.log('🛑 Остановка старых эмуляторов...');
    
    if (process.platform === 'win32') {
      await exec('taskkill /f /im firebase.exe');
      await exec('taskkill /f /im firebase.cmd');
    } else {
      await exec('pkill -f firebase');
    }
    
    // Ждем освобождения портов
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    console.log('✅ Старые эмуляторы остановлены');
  } catch (error) {
    console.log('⚠️  Не удалось остановить старые эмуляторы:', error);
  }
};

export default async function globalSetup() {
  console.log('🚀 Проверка Firebase Emulator Suite...');
  
  try {
    // Проверяем, что Firebase CLI установлен
    await exec('firebase --version');
    
    // Проверяем, запущены ли уже эмуляторы
    const emulatorsRunning = await checkEmulatorsRunning();
    
    if (emulatorsRunning) {
      console.log('⚠️  Эмуляторы уже запущены, проверяем их состояние...');
      
      const emulatorsHealthy = await checkEmulatorsHealth();
      
      if (emulatorsHealthy) {
        console.log('✅ Эмуляторы уже запущены и работают корректно');
        setEmulatorsAlreadyRunning(true);
        return;
      } else {
        console.log('⚠️  Эмуляторы запущены, но не отвечают. Попытка перезапуска...');
        await stopOldEmulators();
      }
    }
    
    console.log('🚀 Запуск новых эмуляторов...');
    
    // Запускаем эмуляторы
    const firebaseCmd = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
    emulatorProcess = spawn(firebaseCmd, [
      'emulators:start',
      '--only',
      'firestore,auth,storage,functions',
      '--project',
      'amulet-test'
    ], {
      stdio: 'pipe',
      cwd: path.join(__dirname, '../../..')
    });

    // Ждем запуска эмуляторов
    await new Promise((resolve, reject) => {
      let output = '';
      let errorOutput = '';
      
      emulatorProcess.stdout.on('data', (data: Buffer) => {
        output += data.toString();
        console.log(data.toString());
        
        // Проверяем, что эмуляторы запустились
        if (output.includes('All emulators ready!') || 
            output.includes('Emulator UI ready at')) {
          resolve(true);
        }
      });

      emulatorProcess.stderr.on('data', (data: Buffer) => {
        errorOutput += data.toString();
        console.error(data.toString());
        
        // Проверяем на ошибки портов
        if (errorOutput.includes('EADDRINUSE') || 
            errorOutput.includes('port is already in use')) {
          reject(new Error('Порт уже используется. Попробуйте остановить старые эмуляторы.'));
        }
      });

      emulatorProcess.on('error', (error: Error) => {
        console.error('Ошибка запуска эмуляторов:', error);
        reject(error);
      });

      // Таймаут на случай, если эмуляторы не запустятся
      setTimeout(() => {
        if (!output.includes('All emulators ready!')) {
          reject(new Error('Таймаут запуска эмуляторов. Возможно, порты заняты.'));
        }
      }, 60000); // 60 секунд
    });

    // Дополнительная пауза для стабилизации
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    console.log('✅ Firebase Emulator Suite запущен успешно');
    
    // Сохраняем PID процесса для завершения в teardown
    if (emulatorProcess.pid) {
      fs.writeFileSync(
        path.join(__dirname, '../../.emulator.pid'), 
        emulatorProcess.pid.toString()
      );
    }
    
  } catch (error) {
    console.error('❌ Ошибка при запуске эмуляторов:', error);
    
    // Предлагаем решения
    console.log('\n🔧 Возможные решения:');
    console.log('1. Остановите старые эмуляторы: firebase emulators:stop');
    console.log('2. Убейте процессы Firebase: pkill -f firebase');
    console.log('3. Проверьте занятые порты: lsof -i :8080,9099,9199,5001');
    console.log('4. Перезапустите терминал и попробуйте снова');
    
    throw error;
  }
}

// Флаг больше не экспортируется, используется общее состояние
