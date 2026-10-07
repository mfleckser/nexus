import { createContext, useContext } from "react";

// Shows `what` ("Couldn't save task") plus the error's message as an
// unobtrusive notice, and logs the error.
export type ReportError = (what: string, err: unknown) => void;

export const ReportErrorContext = createContext<ReportError | null>(null);

export function errorMessage(err: unknown): string {
    if (err instanceof Error) return err.message;
    return typeof err === "string" ? err : "Unknown error";
}

export default function useReportError(): ReportError {
    const report = useContext(ReportErrorContext);
    if (!report) throw new Error("useReportError must be used within ErrorNoticesProvider");
    return report;
}
