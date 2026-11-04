import React from 'react';

interface ErrorBoundaryProps {
  children: React.ReactNode;
}

interface ErrorBoundaryState {
  failed: boolean;
}

/**
 * Catches a screen that crashes while drawing, so the person sees a calm message and a way back instead of a blank page.
 * Nothing about the error is shown on screen. It goes to the browser console for whoever is looking into it.
 */
export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: unknown): void {
    console.error('[UI] A screen stopped working:', error);
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div role="alert" className="max-w-md mx-auto my-16 text-center space-y-4 px-4">
        <h2 className="font-display font-bold text-xl text-slate-900 dark:text-white">Something went wrong on this page</h2>
        <p className="text-sm text-slate-600 dark:text-slate-300">
          Your account and money are safe. Please reload the page. If it keeps happening, let us know and we will look into it right away.
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="px-5 py-2.5 rounded-xl text-sm font-bold bg-gradient-to-r from-amber-400 to-amber-500 text-slate-900 cursor-pointer"
        >
          Reload the page
        </button>
      </div>
    );
  }
}
