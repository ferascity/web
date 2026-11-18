import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly instead of silently starting a second server on another port.
    // Two dev servers share node_modules/.vite and invalidate each other's
    // optimized dependency chunks, which shows up as 504 (Outdated Optimize Dep).
    strictPort: true,
    host: true,
  },
  optimizeDeps: {
    // Pre-bundle the wallet stack at startup. These are discovered late
    // (the Privy embedded-wallet screen is a dynamic import), and on-demand
    // re-optimization breaks already-open tabs.
    include: [
      'buffer',
      '@privy-io/react-auth',
      '@privy-io/react-auth/solana',
      '@solana/kit',
      '@solana/web3.js',
    ],
  },
  build: {
    target: 'es2022',
  },
});
