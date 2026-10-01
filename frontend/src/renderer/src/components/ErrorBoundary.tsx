import { Component, ErrorInfo, ReactNode } from "react";
import "./errorBoundary.css";

type ErrorBoundaryProps = { children: ReactNode };
type ErrorBoundaryState = { error: Error | null };

// Last-resort fallback for render errors anywhere in the app.
export default class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
    state: ErrorBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): ErrorBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo): void {
        console.error("Render error", error, info.componentStack);
    }

    render(): ReactNode {
        const { error } = this.state;
        if (!error) return this.props.children;
        return (
            <div className="error-boundary" role="alert">
                <div className="error-boundary-card">
                    <h1 className="error-boundary-title">Something went wrong</h1>
                    <p className="error-boundary-detail">{error.message}</p>
                    <button type="button" className="error-boundary-reload" onClick={() => window.location.reload()}>
                        Reload
                    </button>
                </div>
            </div>
        );
    }
}
