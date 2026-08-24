import { Component, type ErrorInfo, type ReactNode } from 'react';

interface RouteErrorBoundaryProps {
  children: ReactNode;
  compact?: boolean;
  fallback?: ReactNode;
  message?: string;
  bypassLabel?: string;
  onBypass?: () => void;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
  resetKey?: string;
}

interface RouteErrorBoundaryState {
  error?: Error;
}

function shouldLogRouteErrors() {
  return typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname);
}

export class RouteErrorBoundary extends Component<RouteErrorBoundaryProps, RouteErrorBoundaryState> {
  state: RouteErrorBoundaryState = {};

  static getDerivedStateFromError(error: Error): RouteErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    this.props.onError?.(error, errorInfo);
    if (shouldLogRouteErrors()) {
      console.error('[RouteErrorBoundary]', error, errorInfo);
    }
  }

  componentDidUpdate(previousProps: RouteErrorBoundaryProps) {
    if (previousProps.resetKey !== this.props.resetKey && this.state.error) {
      this.setState({ error: undefined });
    }
  }

  private reset = () => {
    this.setState({ error: undefined });
  };

  render() {
    if (!this.state.error) return this.props.children;
    if (this.props.fallback) return this.props.fallback;

    const message = this.props.message ?? '화면을 불러오지 못했습니다.';
    const compactClasses = this.props.compact
      ? 'rounded-md border border-red-200 bg-red-50 p-3 text-xs text-red-800'
      : 'rounded-lg border border-red-200 bg-red-50 p-5 text-sm text-red-900 shadow-surface';

    return (
      <div className={compactClasses} role="alert">
        <p className="font-semibold">{message}</p>
        <p className="mt-1 text-red-700">일부 데이터가 손상되었거나 렌더링 중 문제가 발생했습니다.</p>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={this.reset}
            className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium text-red-800 hover:bg-red-100"
          >
            다시 시도
          </button>
          {this.props.onBypass ? (
            <button
              type="button"
              onClick={() => {
                this.props.onBypass?.();
                this.reset();
              }}
              className="rounded-md border border-red-300 bg-white px-3 py-1.5 font-medium text-red-800 hover:bg-red-100"
            >
              {this.props.bypassLabel ?? '캐시 무시하고 열기'}
            </button>
          ) : null}
        </div>
      </div>
    );
  }
}
