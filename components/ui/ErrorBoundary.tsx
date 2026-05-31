'use client';
import { Component, ReactNode, ErrorInfo } from 'react';

interface Props {
  children: ReactNode;
  fallbackTitle?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Structured error logging — emitted to the console, which Vercel
    // captures as runtime logs (readable via the dashboard / Vercel MCP).
    // Stable JSON shape so failures can be searched/aggregated later.
    // Zero external dependencies by design.
    try {
      // eslint-disable-next-line no-console
      console.error(
        JSON.stringify({
          type: 'react_error_boundary',
          ts: new Date().toISOString(),
          section: this.props.fallbackTitle || 'unknown',
          message: error?.message || String(error),
          stack: error?.stack?.split('\n').slice(0, 4).join(' | '),
          componentStack: info?.componentStack?.split('\n').slice(0, 4).join(' | '),
        })
      );
    } catch {
      // eslint-disable-next-line no-console
      console.error('[ErrorBoundary]', error);
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          minHeight: 200, padding: '24px', textAlign: 'center',
          background: 'rgba(232,53,53,0.03)', border: '1px solid rgba(232,53,53,0.15)',
          borderRadius: 6, margin: 12,
        }}>
          <span style={{ fontFamily: 'IBM Plex Mono, monospace', fontSize: 16, color: '#E83535', marginBottom: 10 }}>✗</span>
          <span style={{
            fontFamily: 'IBM Plex Mono, monospace', fontSize: 9, fontWeight: 600,
            color: '#E83535', letterSpacing: '1.2px', textTransform: 'uppercase', marginBottom: 8,
          }}>
            Rendering Error
          </span>
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--t1)', marginBottom: 4 }}>
            {this.props.fallbackTitle || 'This section encountered an error'}
          </span>
          <span style={{ fontSize: 10, color: 'var(--t2)', lineHeight: 1.5, maxWidth: 400, marginBottom: 12 }}>
            {this.state.error?.message || 'An unexpected error occurred while rendering this component. The rest of the dashboard remains functional.'}
          </span>
          <button
            onClick={() => this.setState({ hasError: false, error: null })}
            style={{
              padding: '5px 14px', fontSize: 10, fontWeight: 600,
              fontFamily: 'IBM Plex Mono, monospace', background: 'var(--bg3)',
              color: 'var(--t1)', border: '1px solid var(--line)', borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
