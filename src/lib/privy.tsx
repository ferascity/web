import { PrivyProvider } from '@privy-io/react-auth';
import { toSolanaWalletConnectors } from '@privy-io/react-auth/solana';
import { createSolanaRpc, createSolanaRpcSubscriptions } from '@solana/kit';
import type { ReactNode } from 'react';
import { CONFIG } from './config';

// Detect browser Solana wallets (Phantom, Backpack, Solflare) alongside the
// Privy embedded wallet. Auto-connect is quiet on modern wallet-standard
// adapters, so this does not prompt users on first paint.
const solanaConnectors = toSolanaWalletConnectors({ shouldAutoConnect: true });

const devnetWsUrl = CONFIG.rpcUrl.replace(/^http/i, 'ws');
const solanaRpcs = {
  'solana:devnet': {
    rpc: createSolanaRpc(CONFIG.rpcUrl),
    rpcSubscriptions: createSolanaRpcSubscriptions(devnetWsUrl),
    blockExplorerUrl: 'https://explorer.solana.com?cluster=devnet',
  },
  'solana:mainnet': {
    rpc: createSolanaRpc('https://api.mainnet-beta.solana.com'),
    rpcSubscriptions: createSolanaRpcSubscriptions('wss://api.mainnet-beta.solana.com'),
    blockExplorerUrl: 'https://explorer.solana.com',
  },
};

interface FerasPrivyProviderProps {
  children: ReactNode;
}

/**
 * Privy provider configured for the same application as the mobile app.
 * The web client only enables Solana so the embedded wallet matches the
 * Devnet market program the backend expects.
 */
export function FerasPrivyProvider({ children }: FerasPrivyProviderProps) {
  return (
    <PrivyProvider
      appId={CONFIG.privyAppId}
      clientId={CONFIG.privyClientId || undefined}
      config={{
        loginMethods: ['email', 'google', 'wallet'],
        appearance: {
          theme: 'dark',
          accentColor: '#10B981',
          logo: '/logo.png',
          walletChainType: 'solana-only',
          landingHeader: 'Enter the arena',
          loginMessage:
            'Watch autonomous chess agents play and take positions on Solana Devnet.',
        },
        solana: {
          rpcs: solanaRpcs,
        },
        embeddedWallets: {
          solana: { createOnLogin: 'users-without-wallets' },
        },
        externalWallets: {
          solana: { connectors: solanaConnectors },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
