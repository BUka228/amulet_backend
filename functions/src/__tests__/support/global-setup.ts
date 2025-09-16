import { spawn } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import fetch from 'node-fetch'; // Используем node-fetch для проверки
import { setEmulatorsAlreadyRunning } from './emulator-state';


// --- КОНФИГУРАЦИЯ ---
const PROJECT_ID = 'amulet-test';
const FIRESTORE_PORT = 8080;
const AUTH_PORT = 9099;
const STORAGE_PORT = 9199;
const FUNCTIONS_PORT = 5001;
const HOSTING_PORT = 5000;
const EMULATOR_PORTS = [FIRESTORE_PORT, AUTH_PORT, STORAGE_PORT, FUNCTIONS_PORT, HOSTING_PORT];

let emulatorProcess: any;

// Функция для проверки, слушается ли порт
const isPortInUse = (port: number): Promise<boolean> => {
	return new Promise((resolve) => {
		const server = require('net').createServer();
		server.once('error', (err: any) => {
			if (err.code === 'EADDRINUSE') {
				resolve(true); // Порт занят
			}
		});
		server.once('listening', () => {
			server.close();
			resolve(false); // Порт свободен
		});
		server.listen(port);
	});
};

// Функция для проверки "здоровья" эмулятора Firestore
const checkFirestoreHealth = async (): Promise<boolean> => {
	try {
		const response = await fetch(`http://127.0.0.1:${FIRESTORE_PORT}`);
		// Эмулятор Firestore отдает 404 на корневой запрос, это нормально
		return response.status === 404;
	} catch (error) {
		return false;
	}
};

export default async function globalSetup() {
	console.log('🚀 [Global Setup] Проверка Firebase Emulator Suite...');

	const portsAreInUse = (await Promise.all(EMULATOR_PORTS.map(isPortInUse))).some(Boolean);

	if (portsAreInUse) {
		console.log('    - Порты эмуляторов заняты. Проверяем состояние...');
		const isHealthy = await checkFirestoreHealth();
		if (isHealthy) {
			console.log('✅ [Global Setup] Эмуляторы уже запущены и отвечают. Пропускаем запуск.');
			setEmulatorsAlreadyRunning(true);
			return;
		} else {
			console.error('❌ [Global Setup] Эмуляторы запущены, но не отвечают! Пожалуйста, остановите их вручную (`firebase emulators:stop`) и перезапустите тесты.');
			throw new Error('Hanging emulators detected');
		}
	}

	console.log('    - Эмуляторы не запущены. Запускаем новый процесс...');

	const firebaseCmd = process.platform === 'win32' ? 'firebase.cmd' : 'firebase';
	const projectRoot = path.join(__dirname, '..', '..', '..', '..', '..'); // Путь к корню проекта (где firebase.json)

	emulatorProcess = spawn(
		firebaseCmd,
		[
			'emulators:start',
			'--only',
			'auth,functions,firestore,storage,hosting',
			'--project',
			PROJECT_ID,
		],
		{
			cwd: projectRoot, // Указываем рабочую директорию
			shell: true,      // ВАЖНО для Windows, помогает правильно находить .cmd
			detached: true,   // Позволит нам убить процесс и его дочерние процессы
		}
	);

	// Сохраняем PID, чтобы убить процесс в teardown
	if (emulatorProcess.pid) {
		fs.writeFileSync(path.join(__dirname, '.emulator.pid'), emulatorProcess.pid.toString());
	}

	// Ждем, пока эмуляторы запустятся
	await new Promise<void>((resolve, reject) => {
		const timeout = setTimeout(() => {
			reject(new Error('Таймаут запуска эмуляторов (60 секунд).'));
		}, 60000);

		emulatorProcess.stdout.on('data', (data: Buffer) => {
			const output = data.toString();
			console.log(output); // Показываем лог запуска для отладки
			if (output.includes('All emulators ready!')) {
				console.log('✅ [Global Setup] Эмуляторы готовы!');
				clearTimeout(timeout);
				resolve();
			}
		});

		emulatorProcess.stderr.on('data', (data: Buffer) => {
			console.error(data.toString());
		});

		emulatorProcess.on('error', (err: Error) => {
			clearTimeout(timeout);
			reject(err);
		});

		emulatorProcess.on('exit', (code: number) => {
			if (code !== 0) {
				clearTimeout(timeout);
				reject(new Error(`Процесс эмулятора завершился с кодом ${code}`));
			}
		});
	});

	// Дополнительная пауза, чтобы все сервисы стабилизировались
	await new Promise(resolve => setTimeout(resolve, 3000));
}