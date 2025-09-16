/**
 * Общее состояние эмуляторов для тестов
 */

export let emulatorsAlreadyRunning = false;

export const setEmulatorsAlreadyRunning = (value: boolean) => {
  emulatorsAlreadyRunning = value;
};

export const getEmulatorsAlreadyRunning = () => {
  return emulatorsAlreadyRunning;
};


