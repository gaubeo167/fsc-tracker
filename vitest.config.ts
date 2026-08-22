import path from 'path';
import {defineConfig} from 'vitest/config';

// Cấu hình riêng cho test, KHÔNG kéo theo plugin của vite.config.ts
// (tailwind + react plugin không cần cho unit test hàm thuần, bỏ đi cho nhanh).
// Alias phải khai lại y hệt vite.config.ts:13-16, nếu không mọi import '@/...'
// chạy được lúc build nhưng fail trong test.
export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
      '@support': path.resolve(__dirname, 'src/modules/support'),
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    // Test rules chạy trên emulator, cần nhiều thời gian hơn mặc định 5s.
    testTimeout: 15000,
  },
});
