import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  fallback: (message: string) => ReactNode;
}

interface State {
  message: string | null;
}

export class ErrorBoundary extends Component<Props, State> {
  override state: State = { message: null };

  static getDerivedStateFromError(err: unknown): State {
    return { message: err instanceof Error ? err.message : String(err) };
  }

  override render() {
    return this.state.message ? this.props.fallback(this.state.message) : this.props.children;
  }
}
