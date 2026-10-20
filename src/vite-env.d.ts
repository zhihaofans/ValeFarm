/// <reference types="vite/client" />

// 由 vite.config.ts 在 dev server 启动 / build 时注入
declare const __APP_VERSION__: string;
declare const __APP_BUILD__: string;
declare const __BUILD_TIME__: string;
