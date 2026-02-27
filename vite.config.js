import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron/simple';
import renderer from 'vite-plugin-electron-renderer';
import path from 'path';

export default defineConfig({
    plugins: [
        react(),
        electron({
            main: {
                entry: 'electron/main.js',
            },
            renderer: {},
        }),
        renderer(),
    ],
    resolve: {
        alias: {
            '@': path.resolve(__dirname, './src'),
        },
    },
});
