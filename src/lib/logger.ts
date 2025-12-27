import { db } from './db';

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
    details?: any;
}

class LoggerService {
    async log(level: LogLevel, message: string, details?: any) {
        const entry: LogEntry = {
            timestamp: Date.now(),
            level,
            message,
            details
        };

        // Log to console for dev
        const style = level === 'error' ? 'color: red' : level === 'success' ? 'color: green' : 'color: blue';
        console.log(`%c[${level.toUpperCase()}] ${message}`, style, details || '');

        // Persist to DB
        try {
            // We need to add a 'logs' table to DB schema first.
            // Since schema migration in Dexie requires version bump, we'll handle that in db.ts
            // For now, let's assume table exists or we handle it gracefully.
            // To avoid circular dependency if we import db here and db imports something...
            // but db.ts is pure. 
            await db.table('logs').add(entry);
        } catch (e) {
            console.error("Failed to write log", e);
        }
    }

    info(message: string, details?: any) { this.log(LogLevel.INFO, message, details); }
    success(message: string, details?: any) { this.log(LogLevel.SUCCESS, message, details); }
    warn(message: string, details?: any) { this.log(LogLevel.WARN, message, details); }
    error(message: string, details?: any) { this.log(LogLevel.ERROR, message, details); }
}

export const logger = new LoggerService();
