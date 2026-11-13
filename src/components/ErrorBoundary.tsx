/** If a screen crashes, show what happened and a way back instead of a blank window. */
import { Component, type ErrorInfo, type ReactNode } from 'react';

export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Aether crashed:', error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="grid h-full place-items-center bg-ae-bg p-6 text-ae-text">
        <div className="max-w-md space-y-3 text-center">
          <h1 className="text-xl font-bold">Something went wrong</h1>
          <p className="text-sm text-ae-muted">Aether hit an error on this screen. Your messages and settings are safe.</p>
          <pre className="max-h-32 overflow-auto rounded-ae bg-ae-sunken p-3 text-left text-xs whitespace-pre-wrap text-ae-muted">{error.message}</pre>
          <div className="flex justify-center gap-2">
            <button type="button" className="rounded-ae bg-ae-surface px-4 py-2 text-sm font-semibold" onClick={() => this.setState({ error: null })}>
              Try again
            </button>
            <button type="button" className="rounded-ae bg-ae-accent px-4 py-2 text-sm font-semibold text-ae-on-accent" onClick={() => location.reload()}>
              Reload Aether
            </button>
          </div>
        </div>
      </div>
    );
  }
}
