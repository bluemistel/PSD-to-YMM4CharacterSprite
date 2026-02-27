import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);

console.log('--- ESM createRequire Test ---');
try {
    const electron = require('electron');
    console.log('Electron type:', typeof electron);
    console.log('Electron content:', Object.keys(electron));
    console.log('App:', typeof electron.app);
} catch (e) {
    console.error('Require failed:', e);
}
