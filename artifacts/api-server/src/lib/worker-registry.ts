import type { Worker } from "./worker";

// Le worker est créé au démarrage (index.ts) ; les routes le réveillent sans dépendre de son module.
let current: Worker | null = null;
export const setWorker = (worker: Worker | null) => { current = worker; };
export const wakeWorker = () => current?.wake();
