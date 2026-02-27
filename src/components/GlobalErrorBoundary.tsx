import { Component, ErrorInfo, ReactNode } from "react";
import { resetDatabase } from "@/lib/db";
import { AlertTriangle, RefreshCw } from "lucide-react";

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class GlobalErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null,
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error("Uncaught error:", error, errorInfo);
    }

    private handleReset = async () => {
        // Force nuke DB
        await resetDatabase();
        // Force hard reload
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            const isDbError =
                this.state.error?.name === "DatabaseClosedError" ||
                this.state.error?.message?.includes("backing store") ||
                this.state.error?.name === "UnknownError";

            return (
                <div className="flex flex-col items-center justify-center h-screen bg-[#0F0F0F] text-white p-8 text-center space-y-6">
                    <div className="w-24 h-24 rounded-full bg-red-500/10 flex items-center justify-center border border-red-500/20">
                        <AlertTriangle className="text-red-500 w-12 h-12" />
                    </div>

                    <h1 className="text-3xl font-bold">
                        {isDbError ? "Database Corruption Detected" : "Application Error"}
                    </h1>

                    <p className="text-gray-400 max-w-md">
                        {isDbError
                            ? "The local database has been corrupted (likely due to multiple tabs or versions). We need to reset the local cache to fix this."
                            : this.state.error?.message || "An unexpected error occurred."}
                    </p>

                    <button
                        onClick={this.handleReset}
                        className="flex items-center gap-2 bg-red-600 hover:bg-red-500 text-white px-8 py-3 rounded-xl font-bold transition-all shadow-lg shadow-red-600/20 hover:scale-105 active:scale-95"
                    >
                        <RefreshCw className="w-5 h-5" />
                        {isDbError ? "Reset Database & Reload" : "Reload Application"}
                    </button>
                </div>
            );
        }

        return this.props.children;
    }
}
