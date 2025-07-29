import { ErrorHandler } from './ErrorHandler';
import { Logger, LogCategory } from './Logger';

/**
 * Retry configuration options
 */
export interface RetryOptions {
    maxAttempts: number;
    baseDelay: number;
    maxDelay: number;
    exponential: boolean;
    retryCondition?: (error: any) => boolean;
    onRetry?: (error: any, attempt: number) => void;
}

/**
 * Default retry configurations for different operations
 */
export const RETRY_CONFIGS = {
    DATABASE: {
        maxAttempts: 3,
        baseDelay: 1000,
        maxDelay: 5000,
        exponential: true
    },
    EMAIL: {
        maxAttempts: 5,
        baseDelay: 2000,
        maxDelay: 30000,
        exponential: true
    },
    EXTERNAL_API: {
        maxAttempts: 3,
        baseDelay: 500,
        maxDelay: 3000,
        exponential: true
    },
    NETWORK: {
        maxAttempts: 2,
        baseDelay: 1000,
        maxDelay: 2000,
        exponential: false
    }
} as const;

/**
 * Utility class for implementing retry logic with exponential backoff
 */
export class RetryHandler {
    private static logger = Logger.getInstance();

    /**
     * Execute a function with retry logic
     */
    static async withRetry<T>(
        operation: () => Promise<T>,
        options: RetryOptions,
        context?: {
            operationName?: string;
            userId?: string;
            category?: LogCategory;
        }
    ): Promise<T> {
        const {
            maxAttempts,
            baseDelay,
            maxDelay,
            exponential,
            retryCondition = this.defaultRetryCondition,
            onRetry
        } = options;

        const operationName = context?.operationName || 'unknown operation';
        const userId = context?.userId;
        const category = context?.category || LogCategory.SYSTEM;

        let lastError: any;

        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
            try {
                this.logger.debug(
                    category,
                    `Attempting ${operationName} (attempt ${attempt}/${maxAttempts})`,
                    { attempt, maxAttempts },
                    userId
                );

                const result = await operation();

                if (attempt > 1) {
                    this.logger.info(
                        category,
                        `${operationName} succeeded after ${attempt} attempts`,
                        { attempt, totalAttempts: attempt },
                        userId
                    );
                }

                return result;
            } catch (error) {
                lastError = error;
                const errorInfo = ErrorHandler.classifyError(error);

                this.logger.warn(
                    category,
                    `${operationName} failed on attempt ${attempt}`,
                    {
                        attempt,
                        maxAttempts,
                        errorType: errorInfo.type,
                        errorMessage: errorInfo.technicalMessage,
                        willRetry: attempt < maxAttempts && retryCondition(error)
                    },
                    userId
                );

                // Check if we should retry
                if (attempt >= maxAttempts || !retryCondition(error)) {
                    break;
                }

                // Call retry callback if provided
                if (onRetry) {
                    try {
                        onRetry(error, attempt);
                    } catch (callbackError) {
                        this.logger.warn(
                            category,
                            'Retry callback failed',
                            { callbackError: String(callbackError) },
                            userId
                        );
                    }
                }

                // Calculate delay
                const delay = this.calculateDelay(attempt, baseDelay, maxDelay, exponential);

                this.logger.debug(
                    category,
                    `Waiting ${delay}ms before retry`,
                    { delay, attempt },
                    userId
                );

                await this.sleep(delay);
            }
        }

        // All attempts failed
        this.logger.error(
            category,
            `${operationName} failed after ${maxAttempts} attempts`,
            lastError,
            { maxAttempts, operationName },
            userId
        );

        throw lastError;
    }

    /**
     * Retry database operations
     */
    static async retryDatabase<T>(
        operation: () => Promise<T>,
        operationName?: string,
        userId?: string
    ): Promise<T> {
        const context: any = {
            operationName: operationName || 'database operation',
            category: LogCategory.DATABASE
        };
        if (userId) context.userId = userId;

        return this.withRetry(operation, RETRY_CONFIGS.DATABASE, context);
    }

    /**
     * Retry email operations
     */
    static async retryEmail<T>(
        operation: () => Promise<T>,
        operationName?: string,
        userId?: string
    ): Promise<T> {
        const context: any = {
            operationName: operationName || 'email operation',
            category: LogCategory.EMAIL
        };
        if (userId) context.userId = userId;

        return this.withRetry(operation, RETRY_CONFIGS.EMAIL, context);
    }

    /**
     * Retry external API calls
     */
    static async retryExternalAPI<T>(
        operation: () => Promise<T>,
        operationName?: string,
        userId?: string
    ): Promise<T> {
        const context: any = {
            operationName: operationName || 'external API call',
            category: LogCategory.SYSTEM
        };
        if (userId) context.userId = userId;

        return this.withRetry(operation, RETRY_CONFIGS.EXTERNAL_API, context);
    }

    /**
     * Retry network operations
     */
    static async retryNetwork<T>(
        operation: () => Promise<T>,
        operationName?: string,
        userId?: string
    ): Promise<T> {
        const context: any = {
            operationName: operationName || 'network operation',
            category: LogCategory.SYSTEM
        };
        if (userId) context.userId = userId;

        return this.withRetry(operation, RETRY_CONFIGS.NETWORK, context);
    }

    /**
     * Default retry condition - determines if an error is retryable
     */
    private static defaultRetryCondition(error: any): boolean {
        const errorInfo = ErrorHandler.classifyError(error);
        return errorInfo.retryable;
    }

    /**
     * Database-specific retry condition
     */
    static databaseRetryCondition(error: any): boolean {
        if (!error) return false;

        // AWS DynamoDB specific errors that are retryable
        const retryableCodes = [
            'ProvisionedThroughputExceededException',
            'ThrottlingException',
            'RequestLimitExceeded',
            'ServiceUnavailable',
            'InternalServerError',
            'ItemCollectionSizeLimitExceededException'
        ];

        if (error.code && retryableCodes.includes(error.code)) {
            return true;
        }

        // Network-related errors
        if (error.message) {
            const message = error.message.toLowerCase();
            if (message.includes('network') ||
                message.includes('timeout') ||
                message.includes('connection') ||
                message.includes('econnreset')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Email-specific retry condition (SES)
     */
    static emailRetryCondition(error: any): boolean {
        if (!error) return false;

        // AWS SES specific errors that are retryable
        const retryableCodes = [
            'Throttling',
            'ServiceUnavailable',
            'InternalServerError',
            'RequestTimeout',
            'NetworkingError'
        ];

        if (error.code && retryableCodes.includes(error.code)) {
            return true;
        }

        // Non-retryable SES errors
        const nonRetryableCodes = [
            'MessageRejected',
            'InvalidParameterValue',
            'MailFromDomainNotVerified',
            'ConfigurationSetDoesNotExist'
        ];

        if (error.code && nonRetryableCodes.includes(error.code)) {
            return false;
        }

        // Network-related errors
        if (error.message) {
            const message = error.message.toLowerCase();
            if (message.includes('network') ||
                message.includes('timeout') ||
                message.includes('connection')) {
                return true;
            }
        }

        return false;
    }

    /**
     * Calculate delay with exponential backoff
     */
    private static calculateDelay(
        attempt: number,
        baseDelay: number,
        maxDelay: number,
        exponential: boolean
    ): number {
        if (!exponential) {
            return Math.min(baseDelay, maxDelay);
        }

        // Exponential backoff with jitter
        const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
        const jitter = Math.random() * 0.1 * exponentialDelay; // Add up to 10% jitter
        const delay = exponentialDelay + jitter;

        return Math.min(delay, maxDelay);
    }

    /**
     * Sleep for specified milliseconds
     */
    private static sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    /**
     * Create a circuit breaker pattern for repeated failures
     */
    static createCircuitBreaker<T>(
        operation: () => Promise<T>,
        options: {
            failureThreshold: number;
            resetTimeout: number;
            monitorWindow: number;
        }
    ): () => Promise<T> {
        let failures = 0;
        let lastFailureTime = 0;
        let state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

        return async (): Promise<T> => {
            const now = Date.now();

            // Reset failure count if outside monitor window
            if (now - lastFailureTime > options.monitorWindow) {
                failures = 0;
            }

            // Check circuit breaker state
            if (state === 'OPEN') {
                if (now - lastFailureTime > options.resetTimeout) {
                    state = 'HALF_OPEN';
                    this.logger.info(LogCategory.SYSTEM, 'Circuit breaker transitioning to HALF_OPEN');
                } else {
                    throw new Error('Circuit breaker is OPEN - operation blocked');
                }
            }

            try {
                const result = await operation();

                // Reset on success
                if (state === 'HALF_OPEN') {
                    state = 'CLOSED';
                    failures = 0;
                    this.logger.info(LogCategory.SYSTEM, 'Circuit breaker reset to CLOSED');
                }

                return result;
            } catch (error) {
                failures++;
                lastFailureTime = now;

                if (failures >= options.failureThreshold) {
                    state = 'OPEN';
                    this.logger.error(
                        LogCategory.SYSTEM,
                        'Circuit breaker opened due to repeated failures',
                        error,
                        { failures, threshold: options.failureThreshold }
                    );
                }

                throw error;
            }
        };
    }

    /**
     * Wrap an operation with comprehensive error handling and retry logic
     */
    static async executeWithErrorHandling<T>(
        operation: () => Promise<T>,
        options: {
            operationName: string;
            retryConfig?: RetryOptions;
            userId?: string;
            category?: LogCategory;
            fallback?: () => Promise<T>;
        }
    ): Promise<T> {
        const startTime = Date.now();
        const { operationName, retryConfig, userId, category = LogCategory.SYSTEM, fallback } = options;

        try {
            let result: T;

            if (retryConfig) {
                const context: any = { operationName, category };
                if (userId) context.userId = userId;

                result = await this.withRetry(operation, retryConfig, context);
            } else {
                result = await operation();
            }

            // Track successful performance
            this.logger.trackPerformance(operationName, startTime, true, userId);

            return result;
        } catch (error) {
            // Track failed performance
            this.logger.trackPerformance(operationName, startTime, false, userId);

            const errorInfo = ErrorHandler.classifyError(error, { operationName, userId });

            this.logger.error(
                category,
                `Operation failed: ${operationName}`,
                error,
                {
                    operationName,
                    errorType: errorInfo.type,
                    errorSeverity: errorInfo.severity,
                    duration: Date.now() - startTime
                },
                userId
            );

            // Try fallback if available
            if (fallback) {
                try {
                    this.logger.info(category, `Attempting fallback for ${operationName}`, {}, userId);
                    const fallbackResult = await fallback();

                    this.logger.info(category, `Fallback succeeded for ${operationName}`, {}, userId);
                    return fallbackResult;
                } catch (fallbackError) {
                    this.logger.error(
                        category,
                        `Fallback failed for ${operationName}`,
                        fallbackError,
                        { originalError: errorInfo.technicalMessage },
                        userId
                    );
                }
            }

            throw error;
        }
    }
}
