/**
 * Browser polyfills for Node globals used by the Solana/Privy SDKs.
 *
 * Privy's Solana wallet bridge calls `Buffer.from(...)` at runtime, but Vite
 * does not expose Node's Buffer in the browser. Install it before any other
 * module evaluates so signing works on a fresh page load.
 */
import { Buffer } from 'buffer';

const scope = globalThis as typeof globalThis & {
  Buffer?: typeof Buffer;
  global?: typeof globalThis;
};

if (!scope.Buffer) scope.Buffer = Buffer;
// Some bundled dependencies still reference the legacy `global` alias.
if (!scope.global) scope.global = globalThis;

export {};
