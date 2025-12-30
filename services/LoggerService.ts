/**
 * LoggerService - централизованное логирование для приложения
 *
 * В режиме разработки (__DEV__) показывает все логи.
 * В продакшене показывает только WARN и ERROR.
 */

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

// Цвета для консоли (работают в React Native debugger)
const COLORS = {
  DEBUG: '\x1b[36m', // Cyan
  INFO: '\x1b[32m',  // Green
  WARN: '\x1b[33m',  // Yellow
  ERROR: '\x1b[31m', // Red
  RESET: '\x1b[0m',
};

class LoggerService {
  private level: LogLevel;
  private enableColors: boolean;

  constructor() {
    // В DEV режиме показываем все, в продакшене только WARN+
    this.level = __DEV__ ? LogLevel.DEBUG : LogLevel.WARN;
    this.enableColors = true;
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  setColors(enabled: boolean): void {
    this.enableColors = enabled;
  }

  private formatTag(tag: string): string {
    return `[${tag}]`;
  }

  private getTimestamp(): string {
    const now = new Date();
    return now.toISOString().substr(11, 12); // HH:MM:SS.mmm
  }

  debug(tag: string, message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.DEBUG) {
      const prefix = this.enableColors
        ? `${COLORS.DEBUG}DEBUG${COLORS.RESET}`
        : 'DEBUG';
      console.log(`${this.getTimestamp()} ${prefix} ${this.formatTag(tag)} ${message}`, ...args);
    }
  }

  info(tag: string, message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.INFO) {
      const prefix = this.enableColors
        ? `${COLORS.INFO}INFO${COLORS.RESET}`
        : 'INFO';
      console.log(`${this.getTimestamp()} ${prefix} ${this.formatTag(tag)} ${message}`, ...args);
    }
  }

  warn(tag: string, message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.WARN) {
      const prefix = this.enableColors
        ? `${COLORS.WARN}WARN${COLORS.RESET}`
        : 'WARN';
      console.warn(`${this.getTimestamp()} ${prefix} ${this.formatTag(tag)} ${message}`, ...args);
    }
  }

  error(tag: string, message: string, ...args: unknown[]): void {
    if (this.level <= LogLevel.ERROR) {
      const prefix = this.enableColors
        ? `${COLORS.ERROR}ERROR${COLORS.RESET}`
        : 'ERROR';
      console.error(`${this.getTimestamp()} ${prefix} ${this.formatTag(tag)} ${message}`, ...args);
    }
  }
}

// Singleton instance
export const logger = new LoggerService();
