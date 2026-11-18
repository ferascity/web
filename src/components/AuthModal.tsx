import {
  useLoginWithEmail,
  useLoginWithOAuth,
  usePrivy,
} from '@privy-io/react-auth';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Icon } from './Icon';

interface AuthModalProps {
  open: boolean;
  onClose: () => void;
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden="true">
      <path
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
        fill="#4285F4"
      />
      <path
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
        fill="#34A853"
      />
      <path
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
        fill="#FBBC05"
      />
      <path
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
        fill="#EA4335"
      />
    </svg>
  );
}

function WalletIcon({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.85}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h13a1 1 0 0 1 1 1v2" />
      <path d="M3 7v11a2 2 0 0 0 2 2h15a1 1 0 0 0 1-1v-9a1 1 0 0 0-1-1H5a2 2 0 0 1-2-2Z" />
      <circle cx="16.5" cy="14" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function AuthModal({ open, onClose }: AuthModalProps) {
  const { authenticated, login: privyLogin } = usePrivy();
  const { initOAuth, loading: oauthLoading } = useLoginWithOAuth({
    onComplete: () => {
      onClose();
    },
  });
  const { sendCode, loginWithCode, state: emailState } = useLoginWithEmail({
    onComplete: () => {
      onClose();
    },
  });

  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [step, setStep] = useState<'initial' | 'otp'>('initial');
  const [error, setError] = useState<string | null>(null);
  const codeInputRef = useRef<HTMLInputElement>(null);

  // Close automatically once authenticated
  useEffect(() => {
    if (authenticated && open) {
      onClose();
    }
  }, [authenticated, open, onClose]);

  // Reset form state when modal opens/closes
  useEffect(() => {
    if (!open) {
      setStep('initial');
      setCode('');
      setError(null);
    }
  }, [open]);

  // Focus OTP input when transitioning to code verification step
  useEffect(() => {
    if (open && step === 'otp') {
      window.setTimeout(() => codeInputRef.current?.focus(), 60);
    }
  }, [open, step]);

  // Escape key to close
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  const isSendingCode = emailState.status === 'sending-code';
  const isSubmittingCode = emailState.status === 'submitting-code';
  const busy = oauthLoading || isSendingCode || isSubmittingCode;

  const handleGoogleLogin = async () => {
    if (busy) return;
    setError(null);
    try {
      await initOAuth({ provider: 'google' });
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not start Google sign-in.',
      );
    }
  };

  const handleWalletLogin = () => {
    if (busy) return;
    setError(null);
    onClose();
    // Open Privy directly scoped to external Solana wallet connection
    privyLogin({
      loginMethods: ['wallet'],
      walletChainType: 'solana-only',
    });
  };

  const handleEmailSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const trimmed = email.trim();
    if (!trimmed || !trimmed.includes('@')) {
      setError('Enter a valid email address.');
      return;
    }
    setError(null);
    try {
      await sendCode({ email: trimmed });
      setStep('otp');
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Could not send verification code. Please check your email address.',
      );
    }
  };

  const handleCodeSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (busy) return;
    const cleaned = code.trim();
    if (cleaned.length < 6) {
      setError('Enter the 6-digit code sent to your email.');
      return;
    }
    setError(null);
    try {
      await loginWithCode({ code: cleaned });
    } catch (err) {
      setError(
        err instanceof Error && err.message
          ? err.message
          : 'Invalid or expired code. Please try again.',
      );
    }
  };

  return (
    <div
      className="auth-modal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div className="auth-modal-backdrop" onClick={onClose} />

      <div className="auth-modal-card">
        <button
          type="button"
          className="auth-modal-close"
          onClick={onClose}
          aria-label="Close sign in dialog"
        >
          <Icon name="close" size={16} />
        </button>

        {step === 'initial' ? (
          <>
            <div className="auth-modal-header">
              <h2 id="auth-modal-title" className="auth-modal-title">
                Welcome back
              </h2>
              <p className="auth-modal-subtitle">
                Sign in to your account to continue
              </p>
            </div>

            <div className="auth-modal-providers">
              <button
                type="button"
                className="auth-provider-btn"
                onClick={() => void handleGoogleLogin()}
                disabled={busy}
                aria-label="Sign in with Google"
              >
                <GoogleIcon className="auth-provider-icon" />
                <span>Google</span>
              </button>

              <button
                type="button"
                className="auth-provider-btn"
                onClick={handleWalletLogin}
                disabled={busy}
                aria-label="Sign in with Solana Wallet"
              >
                <WalletIcon className="auth-provider-icon" />
                <span>Wallet</span>
              </button>
            </div>

            <div className="auth-modal-divider">
              <span>Or continue with email</span>
            </div>

            <form className="auth-email-form" onSubmit={(e) => void handleEmailSubmit(e)}>
              <span className="auth-email-icon" aria-hidden="true">
                <Icon name="mail" size={16} />
              </span>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="name@example.com"
                className="auth-email-input"
                autoComplete="email"
                disabled={busy}
              />
              <button
                type="submit"
                className="auth-email-submit"
                disabled={busy || !email.trim()}
                aria-label="Continue with email"
              >
                {isSendingCode ? (
                  <span className="spinner" />
                ) : (
                  <Icon name="arrow-right" size={15} />
                )}
              </button>
            </form>
          </>
        ) : (
          <>
            <div className="auth-modal-header">
              <h2 id="auth-modal-title" className="auth-modal-title">
                Check your email
              </h2>
              <p className="auth-modal-subtitle">
                Enter the 6-digit code sent to <strong className="text">{email.trim()}</strong>
              </p>
            </div>

            <form className="auth-email-form" onSubmit={(e) => void handleCodeSubmit(e)}>
              <span className="auth-email-icon" aria-hidden="true">
                <Icon name="lock" size={16} />
              </span>
              <input
                ref={codeInputRef}
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                placeholder="6-digit code"
                className="auth-email-input mono auth-otp-input"
                autoComplete="one-time-code"
                disabled={busy}
              />
              <button
                type="submit"
                className="auth-email-submit"
                disabled={busy || code.trim().length < 6}
                aria-label="Verify code"
              >
                {isSubmittingCode ? (
                  <span className="spinner" />
                ) : (
                  <Icon name="arrow-right" size={15} />
                )}
              </button>
            </form>

            <div className="auth-otp-actions">
              <button
                type="button"
                className="auth-otp-link"
                onClick={() => {
                  setStep('initial');
                  setCode('');
                  setError(null);
                }}
                disabled={busy}
              >
                Use a different email
              </button>
              <button
                type="button"
                className="auth-otp-link"
                onClick={() => void handleEmailSubmit({ preventDefault: () => {} } as FormEvent)}
                disabled={busy}
              >
                Resend code
              </button>
            </div>
          </>
        )}

        {error ? (
          <div className="auth-modal-error" role="alert">
            <Icon name="alert" size={14} />
            <span>{error}</span>
          </div>
        ) : null}

        <div className="auth-modal-footer">
          <p>
            By clicking continue, you agree to our{' '}
            <a href="#terms" onClick={(e) => e.preventDefault()}>
              Terms of Service
            </a>{' '}
            and{' '}
            <a href="#privacy" onClick={(e) => e.preventDefault()}>
              Privacy Policy
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
