import React from "react";

type State = { error: Error | null };

/**
 * Root error boundary. Without it, one component throwing during render
 * unmounts the whole tree and the page is left as an empty `#root` — a white
 * screen with nothing to tell the user, or the agent reading a screenshot,
 * what broke. With it, the error message is on the page.
 */
export class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Uncaught render error:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div role="alert" className="mx-auto max-w-xl px-6 py-16 text-foreground">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          This page hit an error and could not be shown.
        </p>
        <pre className="mt-4 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-muted p-3 text-xs">
          {error.message}
        </pre>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-4 rounded-md bg-primary px-4 py-2 text-sm text-primary-foreground"
        >
          Reload
        </button>
      </div>
    );
  }
}
