import { ErrorHandler, ErrorSeverity } from "./ErrorHandler";
import { Logger, LogCategory } from "../utils/Logger";
import { RetryHandler } from "../utils/RetryHandler";

/**
 * Service wrapper that demonstrates comprehensive error handling patterns
 */
export class ServiceWrapper {
    private logger: Logger;

    constructor() {
        this.logger = Logger.getInstance();
    }

    /**
     * Execute database operation with comprehensive error handling
     */
    async executeDatabaseOperation<T>(
        operation: () => Promise<T>,
        operationName: string,
        userId?: string
    ): Promise<T> {
        const startTime = Date.now();

        try {
            this.logger.info(
                LogCategory.DATABASE,
                `Starting ${operationName}`,
                { userId },
                userId
            );

            const context: any = {
                operationName,
                category: LogCategory.DATABASE,
                retryConfig: {
                    maxAttempts: 3,
                    baseDelay: 1000,
                    maxDelay: 5000,
                    exponential: true,
                    retryCondition: RetryHandler.databaseRetryCondition
                },
                fallback: () => this.createDatabaseFallback(operationName)
            };
            if (userId) context.userId = userId;

            const result = await RetryHandler.executeWithErrorHandling(
                operation,
                context
            );

            this.logger.info(
                LogCategory.DATABASE,
                `${operationName} completed successfully`,
                { duration: Date.now() - startTime },
                userId
            );

            return result;
        } catch (error) {
            const errorInfo = ErrorHandler.classifyError(error, {
                operation: operationName,
                userId,
                duration: Date.now() - startTime
            });

            this.logger.error(
                LogCategory.DATABASE,
                `${operationName} failed with ${errorInfo.type}`,
                error,
                {
                    errorSeverity: errorInfo.severity,
                    retryable: errorInfo.retryable,
                    duration: Date.now() - startTime
                },
                userId
            );

            // Re-throw with user-friendly message
            throw new Error(errorInfo.userMessage);
        }
    }

    /**
     * Execute email operation with comprehensive error handling
     */
    async executeEmailOperation<T>(
        operation: () => Promise<T>,
        operationName: string,
        recipient?: string,
        userId?: string
    ): Promise<T> {
        try {
            this.logger.info(
                LogCategory.EMAIL,
                `Starting ${operationName}`,
                { recipient: recipient ? this.maskEmail(recipient) : undefined, userId },
                userId
            );

            const context: any = {
                operationName,
                category: LogCategory.EMAIL,
                retryConfig: {
                    maxAttempts: 5,
                    baseDelay: 2000,
                    maxDelay: 30000,
                    exponential: true,
                    retryCondition: RetryHandler.emailRetryCondition,
                    onRetry: (error: any, attempt: number) => {
                        this.logger.warn(
                            LogCategory.EMAIL,
                            `Email retry attempt ${attempt}`,
                            { error: error.message, recipient: recipient ? this.maskEmail(recipient) : undefined },
                            userId
                        );
                    }
                },
                fallback: () => this.createEmailFallback(operationName, recipient)
            };
            if (userId) context.userId = userId;

            const result = await RetryHandler.executeWithErrorHandling(
                operation,
                context
            );

            this.logger.trackEmail(operationName, recipient || 'unknown', true, 1, { userId });

            return result;
        } catch (error) {
            const errorInfo = ErrorHandler.classifyError(error, {
                operation: operationName,
                recipient: recipient ? this.maskEmail(recipient) : undefined,
                userId
            });

            this.logger.trackEmail(operationName, recipient || 'unknown', false, undefined, {
                errorType: errorInfo.type,
                errorMessage: errorInfo.technicalMessage,
                userId
            });

            throw new Error(errorInfo.userMessage);
        }
    }

    /**
     * Execute operation with rate limiting checks
     */
    async executeWithRateLimit<T>(
        operation: () => Promise<T>,
        operationName: string,
        userId: string,
        rateLimitCheck?: () => Promise<boolean>
    ): Promise<T> {
        try {
            // Check rate limits if provided
            if (rateLimitCheck) {
                const isAllowed = await RetryHandler.retryDatabase(
                    rateLimitCheck,
                    'rate_limit_check',
                    userId
                );

                if (!isAllowed) {
                    this.logger.trackRateLimit(userId, operationName, 0, 0, {
                        operation: operationName
                    });

                    throw new Error('Rate limit exceeded. Please wait before trying again.');
                }
            }

            // Execute the operation
            return await operation();
        } catch (error) {
            const errorInfo = ErrorHandler.classifyError(error);

            if (errorInfo.type === 'RATE_LIMIT_ERROR') {
                this.logger.trackRateLimit(userId, operationName, 0, 0, {
                    operation: operationName,
                    errorMessage: errorInfo.technicalMessage
                });
            }

            throw error;
        }
    }

    /**
     * Create fallback response for database failures
     */
    private async createDatabaseFallback<T>(operationName: string): Promise<T> {
        this.logger.warn(
            LogCategory.DATABASE,
            `Using fallback for ${operationName}`,
            { operationName }
        );

        // For read operations, return empty/default data
        if (operationName.includes('get') || operationName.includes('find') || operationName.includes('list')) {
            return [] as any; // Return empty array for list operations
        }

        // For write operations, throw a user-friendly error
        throw new Error("💾 Database temporarily unavailable. Please try again in a few moments.");
    }

    /**
     * Create fallback response for email failures
     */
    private async createEmailFallback<T>(operationName: string, recipient?: string): Promise<T> {
        this.logger.warn(
            LogCategory.EMAIL,
            `Using fallback for ${operationName}`,
            { operationName, recipient: recipient ? this.maskEmail(recipient) : undefined }
        );

        // For email operations, we can't really provide a fallback
        // So we log the failure and throw a user-friendly error
        throw new Error("📧 Email service temporarily unavailable. Your request has been noted and will be processed when service is restored.");
    }

    /**
     * Mask email for logging
     */
    private maskEmail(email: string): string {
        const [local, domain] = email.split('@');
        if (!domain || !local) return '***@***.***';

        const maskedLocal = local.length > 3
            ? local.substring(0, 2) + '***' + local.substring(local.length - 1)
            : '***';

        return `${maskedLocal}@${domain}`;
    }

    /**
     * Get system health and performance metrics
     */
    async getSystemHealth(): Promise<{
        status: 'healthy' | 'degraded' | 'unhealthy';
        performance: any;
        errors: Record<string, number>;
        uptime: number;
        timestamp: string;
    }> {
        try {
            return this.logger.getSystemHealth();
        } catch (error) {
            this.logger.error(
                LogCategory.SYSTEM,
                'Failed to get system health',
                error
            );

            // Return minimal health info if monitoring fails
            return {
                status: 'unhealthy',
                performance: {
                    avgResponseTime: 0,
                    successRate: 0,
                    errorRate: 100,
                    slowOperations: 0,
                    totalOperations: 0
                },
                errors: { 'monitoring_failure': 1 },
                uptime: process.uptime(),
                timestamp: new Date().toISOString()
            };
        }
    }

    /**
     * Handle critical system errors
     */
    async handleCriticalError(
        error: any,
        context: {
            operation: string;
            userId?: string;
            severity?: ErrorSeverity;
        }
    ): Promise<void> {
        const errorInfo = ErrorHandler.classifyError(error, context);

        // Always log critical errors
        this.logger.critical(
            LogCategory.SYSTEM,
            `Critical error in ${context.operation}`,
            error,
            {
                ...context,
                errorType: errorInfo.type,
                errorSeverity: errorInfo.severity,
                timestamp: new Date().toISOString()
            },
            context.userId
        );

        // Additional alerting could be implemented here:
        // - Send to monitoring systems
        // - Create incident tickets
        // - Notify on-call engineers
        // - Trigger automated recovery procedures
    }
}
