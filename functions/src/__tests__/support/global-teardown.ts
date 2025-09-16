import { promisify } from 'util';
import * as fs from 'fs';
import * as path from 'path';
import { getEmulatorsAlreadyRunning } from './emulator-state';

const exec = promisify(require('child_process').exec);

export default async function globalTeardown() {
    if (getEmulatorsAlreadyRunning()) {
        console.log('ℹ️  [Global Teardown] Эмуляторы были запущены до тестов, оставляем их работать.');
        return;
    }

    console.log('🛑 [Global Teardown] Остановка Firebase Emulator Suite...');
    
    const pidFile = path.join(__dirname, '.emulator.pid');
    let pid: number | null = null;
    if (fs.existsSync(pidFile)) {
        pid = parseInt(fs.readFileSync(pidFile, 'utf8'), 10);
        fs.unlinkSync(pidFile);
    }
    
    if (pid) {
        try {
            if (process.platform === 'win32') {
                // Для Windows нужно убить все дочерние процессы
                await exec(`taskkill /PID ${pid} /T /F`);
            } else {
                // Для Linux/macOS убиваем группу процессов
                process.kill(-pid, 'SIGTERM');
            }
            console.log(`✅ [Global Teardown] Процесс эмулятора (PID: ${pid}) остановлен.`);
        } catch (error) {
            console.warn(`⚠️  [Global Teardown] Не удалось остановить процесс PID ${pid}. Возможно, он уже завершился.`);
            // Пробуем запасной вариант
            await exec('firebase emulators:stop').catch(() => {});
        }
    } else {
        console.log('    - PID не найден, используем `firebase emulators:stop`.');
        await exec('firebase emulators:stop').catch((err: any) => {
            console.warn('⚠️  [Global Teardown] Команда `firebase emulators:stop` завершилась с ошибкой, но это может быть нормально.');
        });
    }
    console.log('✅ [Global Teardown] Очистка завершена.');
}