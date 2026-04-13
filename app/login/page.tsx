'use client';
import { useState } from 'react';
import { signIn } from 'next-auth/react';
import { useRouter } from 'next/navigation';

function FMark() {
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" fill="none">
      <rect width="48" height="48" rx="8" fill="#0B1220"/>
      <path d="M10 8h22l-4 7H16v5h11l-4 7h-7v14H10V8z" fill="#1E6FCC"/>
      <path d="M24 8h8l-12 32H14z" fill="#DCE8F6" opacity="0.8"/>
      <path d="M30 8h8l-12 32H20z" fill="#CC2020"/>
    </svg>
  );
}

export default function LoginPage() {
  const [password, setPassword] = useState('');
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const router                  = useRouter();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    const result = await signIn('credentials', {
      password,
      redirect: false,
    });
    setLoading(false);
    if (result?.ok) {
      router.push('/dashboard/overview');
    } else {
      setError('Invalid access code.');
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: 'var(--bg0)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <div style={{
        width: 360,
        background: 'var(--bg1)',
        border: '1px solid var(--line)',
        padding: '48px 36px',
      }}>
        {/* Brand */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{ display: 'flex', justifyContent: 'center', marginBottom: 16 }}>
            <FMark />
          </div>
          <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: '-0.3px', marginBottom: 4 }}>
            <span style={{ color: 'var(--t0)' }}>Flow</span>
            <span style={{ color: 'var(--brand-red)' }}>Seer</span>
          </div>
          <div style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 9, letterSpacing: '2px', textTransform: 'uppercase',
            color: 'var(--t2)', marginBottom: 4,
          }}>
            TG20/W251 · Client: Borderplex
          </div>
          <div style={{
            fontFamily: 'IBM Plex Mono, monospace',
            fontSize: 9, color: 'var(--t3)', letterSpacing: '1px',
          }}>
            BOP Procurement Intelligence
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit}>
          <div style={{ marginBottom: 16 }}>
            <label style={{
              display: 'block',
              fontFamily: 'IBM Plex Mono, monospace',
              fontSize: 9, letterSpacing: '1.5px', textTransform: 'uppercase',
              color: 'var(--t2)', marginBottom: 8,
            }}>
              Access Code
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="Enter access code"
              autoFocus
              style={{
                width: '100%',
                background: 'var(--bg2)',
                border: `1px solid ${error ? 'var(--red)' : 'var(--edge)'}`,
                color: 'var(--t0)',
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 13,
                padding: '10px 14px',
                outline: 'none',
                borderRadius: 0,
              }}
            />
            {error && (
              <div style={{
                fontFamily: 'IBM Plex Mono, monospace',
                fontSize: 10, color: 'var(--red)',
                marginTop: 6, letterSpacing: '0.3px',
              }}>
                {error}
              </div>
            )}
          </div>

          <button
            type="submit"
            disabled={loading || !password}
            style={{
              width: '100%',
              background: loading ? 'var(--bg3)' : 'var(--brand-blue)',
              color: loading ? 'var(--t2)' : '#fff',
              border: 'none',
              fontFamily: 'IBM Plex Sans, sans-serif',
              fontSize: 12, fontWeight: 600,
              padding: '11px 0',
              cursor: loading ? 'default' : 'pointer',
              letterSpacing: '0.5px',
              transition: 'background 0.15s',
            }}
          >
            {loading ? 'Verifying…' : 'Access Platform'}
          </button>
        </form>

        <div style={{
          marginTop: 32,
          fontFamily: 'IBM Plex Mono, monospace',
          fontSize: 9, color: 'var(--t3)',
          textAlign: 'center', letterSpacing: '0.5px', lineHeight: 1.8,
        }}>
          Trans World Power LLC<br />
          Authorized Personnel Only
        </div>
      </div>
    </div>
  );
}
