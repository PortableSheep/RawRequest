import { Injectable } from '@angular/core';

type DiagnosticLevel = 'INFO' | 'WARNING' | 'ERROR' | 'FATAL' | 'DEBUG';

type DiagnosticBindings = {
  RecordDiagnosticLog?: (level: string, message: string) => Promise<void> | void;
  ExportDiagnosticLogs?: () => Promise<string>;
};

@Injectable({
  providedIn: 'root'
})
export class DiagnosticLoggerService {
  private getBindings(): DiagnosticBindings | undefined {
    return (globalThis as {
      go?: {
        app?: {
          App?: DiagnosticBindings;
        };
      };
    }).go?.app?.App;
  }

  /**
   * Logs a message with a specific diagnostic level.
   * This is sent to the Go backend to be recorded in the persistent log file.
   */
  log(level: DiagnosticLevel, message: string): void {
    const recordDiagnosticLog = this.getBindings()?.RecordDiagnosticLog;
    try {
      if (typeof recordDiagnosticLog === 'function') {
        void recordDiagnosticLog(level, message);
        return;
      }
    } catch (err) {
      // Fallback to browser console if Wails binding is not yet loaded/initialized
      console.warn(`[DiagnosticLoggerService Fallback] [${level}] ${message}`, err);
      return;
    }

    console.warn(`[DiagnosticLoggerService Fallback] [${level}] ${message}`);
  }

  info(message: string): void {
    this.log('INFO', message);
  }

  warn(message: string): void {
    this.log('WARNING', message);
  }

  error(message: string, error?: any): void {
    let finalMsg = message;
    if (error) {
      if (error instanceof Error) {
        finalMsg += ` | Error: ${error.message}\nStack: ${error.stack}`;
      } else {
        try {
          finalMsg += ` | Error details: ${JSON.stringify(error)}`;
        } catch {
          finalMsg += ` | Error details: ${error}`;
        }
      }
    }
    this.log('ERROR', finalMsg);
  }

  /**
   * Triggers the native export flow, opening a native save dialog.
   * Returns the file path where the logs were successfully exported.
   */
  async exportLogs(): Promise<string> {
    const exportDiagnosticLogs = this.getBindings()?.ExportDiagnosticLogs;
    try {
      if (typeof exportDiagnosticLogs !== 'function') {
        throw new Error('Diagnostic log export is unavailable in this environment.');
      }
      return await exportDiagnosticLogs();
    } catch (err) {
      this.error('Failed to export diagnostic logs', err);
      throw err;
    }
  }
}
