/**
 * Log levels for structured logging
 */
export enum LogLevel {
    DEBUG = 'DEBUG',
    INFO = 'INFO',
    WARN = 'WARN',
    ERROR = 'ERROR',
    CRITICAL = 'CRITICAL'
}

/**
 * Log categories for better organization
 */
export enum LogCategory {
    REVIEW = 'REVIEW',
    DATABASE = 'DATABASE',
    EMAIL = 'EMAIL',
    WEBHOOK = 'WEBHOOK',
    RATE_LIMIT = 'RATE_LIMIT',
    PERFORMANCE = 'PERFORMANCE',
    SECURITY = 'SECURITY',
    SYSTEM = 'SYSTEM'
}

/**
 * Structured log entry
 */
export interface LogEntry {
    timestamp: string;
    level: LogLevel;
    category: LogCategory;
    message: string;
    userId?: string;
    sessionId?: string;
    requestId?: string;
    duration?: number;
    metadata?: Record<string, any>;
    error?: {
        name: string;
        message: string;
        stack?: string;
        code?: string;
    };
}

/**
 * Performance metrics
 */
export interface PerformanceMetric {
    operation: string;
    duration: number;
    timestamp: string;
    success: boolean;
    userId?: string;
    metadata?: Record<string, any>;
}

/**
 * Alert configuration
 */
export interface AlertConfig {
    errorThreshold: number;        // Errors per minute
    responseTimeThreshold: number; // Milliseconds
    rateLimitThreshold: number;    // Rate limit violations per hour
    criticalErrorTypes: string[];  // Error types that should always alert
}

/**
 * Comprehensive logging and monitoring service
 */
export class Logger {
    private static instance: Logger;
    private performanceMetrics: PerformanceMetric[] = [];
    private errorCounts: Map<string, number> = new Map();
    private alertConfig: AlertConfig = {
        errorThreshold: 10,           // 10 errors per minute
        responseTimeThreshold: 5000,  // 5 seconds
        rateLimitThreshold: 100,      // 100 rate limit violations per hour
        criticalErrorTypes: ['CRITICAL', 'DATABASE_ERROR', 'EXTERNAL_SERVICE_ERROR']
    };

    private constructor() {
        // Initialize performance metrics cleanup
        this.initializeMetricsCleanup();
    }

    static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * Log debug information
     */
    debug(category: LogCategory, message: string, metadata?: Record<string, any>, userId?: string): void {
        this.log(LogLevel.DEBUG, category, message, metadata, userId);
    }

    /**
     * Log informational messages
     */
    info(category: LogCategory, message: string, metadata?: Record<string, any>, userId?: string): void {
        this.log(LogLevel.INFO, category, message, metadata, userId);
    }

    /**
     * Log warnings
     */
    warn(category: LogCategory, message: string, metadata?: Record<string, any>, userId?: string): void {
        this.log(LogLevel.WARN, category, message, metadata, userId);
    }

    /**
     * Log errors
     */
    error(category: LogCategory, message: string, error?: any, metadata?: Record<string, any>, userId?: string): void {
        const logEntry = this.createLogEntry(LogLevel.ERROR, category, message, metadata, userId);

        if (error) {
            logEntry.error = {
                name: error.name || 'Error',
                message: error.message || String(error),
                stack: error.stack,
                code: error.code
            };
        }

        this.writeLog(logEntry);
        this.trackError(category, message);
        this.checkAlerts(logEntry);
    }

    /**
     * Log critical errors
     */
    critical(category: LogCategory, message: string, error?: any, metadata?: Record<string, any>, userId?: string): void {
        const logEntry = this.createLogEntry(LogLevel.CRITICAL, category, message, metadata, userId);

        if (error) {
            logEntry.error = {
                name: error.name || 'CriticalError',
                message: error.message || String(error),
                stack: error.stack,
                code: error.code
            };
        }

        this.writeLog(logEntry);
        this.trackError(category, message);
        this.triggerCriticalAlert(logEntry);
    }

    /**
     * Track performance metrics
     */
    trackPerformance(operation: string, startTime: number, success: boolean, userId?: string, metadata?: Record<string, any>): void {
        const duration = Date.now() - startTime;

        const metric: PerformanceMetric = {
            operation,
            duration,
            timestamp: new Date().toISOString(),
            success,
            ...(userId && { userId }),
            ...(metadata && { metadata })
        };

        this.performanceMetrics.push(metric);
        this.logPerformanceMetric(metric);

        // Check for performance alerts
        if (duration > this.alertConfig.responseTimeThreshold) {
            this.warn(LogCategory.PERFORMANCE, `Slow operation detected: ${operation}`, {
                duration,
                threshold: this.alertConfig.responseTimeThreshold,
                ...metadata
            }, userId);
        }
    }

    /**
     * Track review operations
     */
    trackReview(userId: string, action: string, courseId?: string, reviewId?: string, metadata?: Record<string, any>): void {
        this.info(LogCategory.REVIEW, `Review ${action}`, {
            action,
            courseId,
            reviewId,
            ...metadata
        }, userId);
    }

    /**
     * Track database operations
     */
    trackDatabase(operation: string, table: string, success: boolean, duration?: number, metadata?: Record<string, any>): void {
        const level = success ? LogLevel.INFO : LogLevel.ERROR;
        this.log(level, LogCategory.DATABASE, `Database ${operation} on ${table}: ${success ? 'SUCCESS' : 'FAILURE'}`, {
            operation,
            table,
            success,
            duration,
            ...metadata
        });
    }

    /**
     * Track email operations
     */
    trackEmail(operation: string, recipient: string, success: boolean, attempts?: number, metadata?: Record<string, any>): void {
        const level = success ? LogLevel.INFO : LogLevel.ERROR;
        this.log(level, LogCategory.EMAIL, `Email ${operation}: ${success ? 'SUCCESS' : 'FAILURE'}`, {
            operation,
            recipient: this.maskEmail(recipient),
            success,
            attempts,
            ...metadata
        });
    }

    /**
     * Track rate limit violations
     */
    trackRateLimit(userId: string, operation: string, currentCount: number, limit: number, metadata?: Record<string, any>): void {
        this.warn(LogCategory.RATE_LIMIT, `Rate limit violation: ${operation}`, {
            currentCount,
            limit,
            violationPercentage: (currentCount / limit) * 100,
            ...metadata
        }, userId);

        this.trackSecurityEvent('rate_limit_violation', userId, { operation, currentCount, limit, ...metadata });
    }

    /**
     * Track security events
     */
    trackSecurityEvent(eventType: string, userId: string, metadata?: Record<string, any>): void {
        this.warn(LogCategory.SECURITY, `Security event: ${eventType}`, {
            eventType,
            ...metadata
        }, userId);
    }

    /**
     * Get performance statistics
     */
    getPerformanceStats(timeWindow: number = 3600000): { // Default 1 hour
        avgResponseTime: number;
        successRate: number;
        errorRate: number;
        slowOperations: number;
        totalOperations: number;
    } {
        const cutoff = Date.now() - timeWindow;
        const recentMetrics = this.performanceMetrics.filter(m =>
            new Date(m.timestamp).getTime() > cutoff
        );

        if (recentMetrics.length === 0) {
            return {
                avgResponseTime: 0,
                successRate: 100,
                errorRate: 0,
                slowOperations: 0,
                totalOperations: 0
            };
        }

        const totalDuration = recentMetrics.reduce((sum, m) => sum + m.duration, 0);
        const successCount = recentMetrics.filter(m => m.success).length;
        const slowCount = recentMetrics.filter(m => m.duration > this.alertConfig.responseTimeThreshold).length;

        return {
            avgResponseTime: Math.round(totalDuration / recentMetrics.length),
            successRate: Math.round((successCount / recentMetrics.length) * 100),
            errorRate: Math.round(((recentMetrics.length - successCount) / recentMetrics.length) * 100),
            slowOperations: slowCount,
            totalOperations: recentMetrics.length
        };
    }

    /**
     * Get error statistics
     */
    getErrorStats(timeWindow: number = 3600000): Record<string, number> {
        const cutoff = Date.now() - timeWindow;
        const stats: Record<string, number> = {};

        for (const [key, count] of this.errorCounts.entries()) {
            if (key.includes('_')) {
                const parts = key.split('_');
                const timestamp = parts.pop();
                const errorKey = parts.join('_');

                if (timestamp && errorKey && parseInt(timestamp) > cutoff) {
                    stats[errorKey] = (stats[errorKey] || 0) + count;
                }
            }
        }

        return stats;
    }

    /**
     * Create structured log entry
     */
    private createLogEntry(
        level: LogLevel,
        category: LogCategory,
        message: string,
        metadata?: Record<string, any>,
        userId?: string
    ): LogEntry {
        const entry: LogEntry = {
            timestamp: new Date().toISOString(),
            level,
            category,
            message
        };

        if (userId) entry.userId = userId;
        if (metadata?.['sessionId']) entry.sessionId = metadata['sessionId'];
        if (metadata?.['requestId']) entry.requestId = metadata['requestId'];
        if (metadata?.['duration']) entry.duration = metadata['duration'];
        if (metadata) entry.metadata = { ...metadata };

        return entry;
    }

    /**
     * Write log entry to console (CloudWatch will capture this)
     */
    private writeLog(entry: LogEntry): void {
        const logData = {
            ...entry,
            // Add AWS Lambda context if available
            lambdaRequestId: process.env['AWS_REQUEST_ID'],
            lambdaFunctionName: process.env['AWS_LAMBDA_FUNCTION_NAME'],
            lambdaFunctionVersion: process.env['AWS_LAMBDA_FUNCTION_VERSION']
        };

        switch (entry.level) {
            case LogLevel.DEBUG:
                console.debug(JSON.stringify(logData));
                break;
            case LogLevel.INFO:
                console.info(JSON.stringify(logData));
                break;
            case LogLevel.WARN:
                console.warn(JSON.stringify(logData));
                break;
            case LogLevel.ERROR:
            case LogLevel.CRITICAL:
                console.error(JSON.stringify(logData));
                break;
        }
    }

    /**
     * Generic log method
     */
    private log(level: LogLevel, category: LogCategory, message: string, metadata?: Record<string, any>, userId?: string): void {
        const entry = this.createLogEntry(level, category, message, metadata, userId);
        this.writeLog(entry);
    }

    /**
     * Log performance metric
     */
    private logPerformanceMetric(metric: PerformanceMetric): void {
        this.info(LogCategory.PERFORMANCE, `Operation completed: ${metric.operation}`, {
            duration: metric.duration,
            success: metric.success,
            ...metric.metadata
        }, metric.userId);
    }

    /**
     * Track errors for alerting
     */
    private trackError(category: LogCategory, message: string): void {
        const key = `${category}_${message}_${Date.now()}`;
        this.errorCounts.set(key, (this.errorCounts.get(key) || 0) + 1);
    }

    /**
     * Check if alerts should be triggered
     */
    private checkAlerts(logEntry: LogEntry): void {
        // Check error rate threshold
        const recentErrors = Array.from(this.errorCounts.entries())
            .filter(([key]) => {
                const timestamp = parseInt(key.split('_').pop() || '0');
                return Date.now() - timestamp < 60000; // Last minute
            })
            .reduce((sum, [, count]) => sum + count, 0);

        if (recentErrors >= this.alertConfig.errorThreshold) {
            this.triggerAlert('High error rate detected', {
                errorCount: recentErrors,
                threshold: this.alertConfig.errorThreshold,
                timeWindow: '1 minute'
            });
        }

        // Check for critical error types
        if (this.alertConfig.criticalErrorTypes.includes(logEntry.level) ||
            this.alertConfig.criticalErrorTypes.includes(logEntry.category)) {
            this.triggerAlert('Critical error detected', {
                level: logEntry.level,
                category: logEntry.category,
                message: logEntry.message,
                userId: logEntry.userId
            });
        }
    }

    /**
     * Trigger critical alert
     */
    private triggerCriticalAlert(logEntry: LogEntry): void {
        this.triggerAlert('CRITICAL ERROR DETECTED', {
            level: logEntry.level,
            category: logEntry.category,
            message: logEntry.message,
            userId: logEntry.userId,
            error: logEntry.error
        });
    }

    /**
     * Trigger alert (in production, this would integrate with CloudWatch Alarms or SNS)
     */
    private triggerAlert(alertType: string, details: Record<string, any>): void {
        const alertLog: LogEntry = {
            timestamp: new Date().toISOString(),
            level: LogLevel.CRITICAL,
            category: LogCategory.SYSTEM,
            message: `ALERT: ${alertType}`,
            metadata: {
                alertType,
                ...details,
                environment: process.env['NODE_ENV'] || 'development'
            }
        };

        this.writeLog(alertLog);

        // In production, you would also:
        // - Send to CloudWatch Alarms
        // - Publish to SNS topic
        // - Send to Slack/Teams webhook
        // - Create incident in PagerDuty
    }

    /**
     * Mask sensitive information in email addresses
     */
    private maskEmail(email: string): string {
        const [local, domain] = email.split('@');
        if (!domain || !local) return '***';

        const maskedLocal = local.length > 3
            ? local.substring(0, 2) + '***' + local.substring(local.length - 1)
            : '***';

        return `${maskedLocal}@${domain}`;
    }

    /**
     * Initialize cleanup of old metrics
     */
    private initializeMetricsCleanup(): void {
        // Clean up old metrics every hour
        setInterval(() => {
            const cutoff = Date.now() - 86400000; // Keep 24 hours of metrics

            // Clean performance metrics
            this.performanceMetrics = this.performanceMetrics.filter(m =>
                new Date(m.timestamp).getTime() > cutoff
            );

            // Clean error counts
            for (const [key] of this.errorCounts.entries()) {
                const timestamp = parseInt(key.split('_').pop() || '0');
                if (timestamp < cutoff) {
                    this.errorCounts.delete(key);
                }
            }
        }, 3600000); // Every hour
    }

    /**
     * Get system health status
     */
    getSystemHealth(): {
        status: 'healthy' | 'degraded' | 'unhealthy';
        performance: {
            avgResponseTime: number;
            successRate: number;
            errorRate: number;
            slowOperations: number;
            totalOperations: number;
        };
        errors: Record<string, number>;
        uptime: number;
        timestamp: string;
    } {
        const performance = this.getPerformanceStats();
        const errors = this.getErrorStats();

        let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';

        // Determine health status
        if (performance.errorRate > 20 || performance.avgResponseTime > this.alertConfig.responseTimeThreshold) {
            status = 'unhealthy';
        } else if (performance.errorRate > 10 || performance.avgResponseTime > this.alertConfig.responseTimeThreshold / 2) {
            status = 'degraded';
        }

        return {
            status,
            performance,
            errors,
            uptime: process.uptime(),
            timestamp: new Date().toISOString()
        };
    }

    /**
     * Clear all performance metrics and error counts
     * For testing purposes only
     */
    clearMetrics(): void {
        this.performanceMetrics = [];
        this.errorCounts.clear();
    }
}
