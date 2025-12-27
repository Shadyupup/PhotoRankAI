// Imports removed as unused
export enum LogLevel {
    INFO = 'info',
    WARN = 'warn',
    ERROR = 'error',
    SUCCESS = 'success'
}

export interface LogEntry {
    id?: number;
    timestamp: number;
    level: LogLevel;
    message: string;
    details?: unknown;
}

class LoggerService {
    async log(level: LogLevel, message: string, details?: unknown) {
        // const entry: LogEntry = {
        //     timestamp: Date.now(),
        //     level,
        //     message,
        //     details
        // };

        // Emit Custom Event for UI
        if (typeof window !== 'undefined') {
            const event = new CustomEvent('app-log', {
                detail: {
                    time: new Date().toLocaleTimeString(),
                    level,
                    msg: message + (details ? ' ' + JSON.stringify(details) : '')
                }
            });
            window.dispatchEvent(event);
        }

        // Log to console for dev (Silenced for Production Cleanliness)
        const style = level === 'error' ? 'color: red' : level === 'success' ? 'color: green' : 'color: blue';
        console.log(`%c[${level.toUpperCase()}] ${message}`, style, details || '');

        // Persist to DB (Simulated/Optional for now to prevent schema errors if not updated)
        try {
            // await db.table('logs').add(entry);
        } catch (e) {
            console.error("Failed to write log", e);
        }
    }

    info(message: string, details?: unknown) { this.log(LogLevel.INFO, message, details); }
    success(message: string, details?: unknown) { this.log(LogLevel.SUCCESS, message, details); }
    warn(message: string, details?: unknown) { this.log(LogLevel.WARN, message, details); }
    error(message: string, details?: unknown) { this.log(LogLevel.ERROR, message, details); }
}

export const logger = new LoggerService();
