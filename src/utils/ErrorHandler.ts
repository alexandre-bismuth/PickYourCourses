import { ConversationState } from '../models';

/**
 * Types of errors that can occur in the system
 */
export enum ErrorType {
    AUTHENTICATION_ERROR = 'AUTHENTICATION_ERROR',
    AUTHORIZATION_ERROR = 'AUTHORIZATION_ERROR',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
    DATABASE_ERROR = 'DATABASE_ERROR',
    EXTERNAL_SERVICE_ERROR = 'EXTERNAL_SERVICE_ERROR',
    RATE_LIMIT_ERROR = 'RATE_LIMIT_ERROR',
    TIMEOUT_ERROR = 'TIMEOUT_ERROR',
    NETWORK_ERROR = 'NETWORK_ERROR',
    UNKNOWN_ERROR = 'UNKNOWN_ERROR'
}

/**
 * Error severity levels
 */
export enum ErrorSeverity {
    LOW = 'LOW',
    MEDIUM = 'MEDIUM',
    HIGH = 'HIGH',
    CRITICAL = 'CRITICAL'
}

/**
 * Structured error information
 */
export interface ErrorInfo {
    type: ErrorType;
    severity: ErrorSeverity;
    userMessage: string;
    technicalMessage: string;
    retryable: boolean;
    context?: Record<string, any>;
    suggestedActions?: string[];
}

/**
 * Comprehensive error handler for the application
 */
export class ErrorHandler {
    private static readonly USER_FRIENDLY_MESSAGES = {
        [ErrorType.AUTHENTICATION_ERROR]: {
            [ErrorSeverity.LOW]: "🔐 Authentication required. Please use /auth to log in.",
            [ErrorSeverity.MEDIUM]: "❌ Authentication failed. Please check your credentials and try again.",
            [ErrorSeverity.HIGH]: "🚫 Multiple authentication failures detected. Please wait before trying again.",
            [ErrorSeverity.CRITICAL]: "⚠️ Your account has been temporarily blocked due to too many failed attempts."
        },
        [ErrorType.AUTHORIZATION_ERROR]: {
            [ErrorSeverity.LOW]: "🔒 You don't have permission to perform this action.",
            [ErrorSeverity.MEDIUM]: "🚫 Admin privileges required for this operation.",
            [ErrorSeverity.HIGH]: "⚠️ Access denied. Contact an administrator if you believe this is an error.",
            [ErrorSeverity.CRITICAL]: "🚨 Unauthorized access attempt detected and logged."
        },
        [ErrorType.VALIDATION_ERROR]: {
            [ErrorSeverity.LOW]: "📝 Please check your input and try again.",
            [ErrorSeverity.MEDIUM]: "❌ Invalid input provided. Please follow the correct format.",
            [ErrorSeverity.HIGH]: "⚠️ Multiple validation errors detected. Please review your input carefully.",
            [ErrorSeverity.CRITICAL]: "🚨 Severe validation error. Please contact Alexandre Bismuth (@alex_bsmth)."
        },
        [ErrorType.DATABASE_ERROR]: {
            [ErrorSeverity.LOW]: "💾 Data operation in progress. Please wait a moment.",
            [ErrorSeverity.MEDIUM]: "❌ Database temporarily unavailable. Please try again in a few seconds.",
            [ErrorSeverity.HIGH]: "⚠️ Database connection issues. Our team has been notified.",
            [ErrorSeverity.CRITICAL]: "🚨 Critical database error. System administrators have been alerted."
        },
        [ErrorType.EXTERNAL_SERVICE_ERROR]: {
            [ErrorSeverity.LOW]: "📧 Email service is experiencing delays. Your request is being processed.",
            [ErrorSeverity.MEDIUM]: "❌ External service temporarily unavailable. Please try again shortly.",
            [ErrorSeverity.HIGH]: "⚠️ Service integration error. Our team is working on a fix.",
            [ErrorSeverity.CRITICAL]: "🚨 Critical service failure. Emergency response activated."
        },
        [ErrorType.RATE_LIMIT_ERROR]: {
            [ErrorSeverity.LOW]: "⏱️ Please wait a moment before sending another message.",
            [ErrorSeverity.MEDIUM]: "❌ You're sending messages too quickly. Please slow down.",
            [ErrorSeverity.HIGH]: "⚠️ Daily message limit approaching. Please use the bot mindfully.",
            [ErrorSeverity.CRITICAL]: "🚫 Message limit exceeded. Access restricted until tomorrow."
        },
        [ErrorType.TIMEOUT_ERROR]: {
            [ErrorSeverity.LOW]: "⏰ Your session will expire soon. Continue interacting to stay logged in.",
            [ErrorSeverity.MEDIUM]: "❌ Session expired. Please authenticate again with /auth.",
            [ErrorSeverity.HIGH]: "⚠️ Extended inactivity detected. Session has been cleared for security.",
            [ErrorSeverity.CRITICAL]: "🚨 System timeout. Please restart your interaction."
        },
        [ErrorType.NETWORK_ERROR]: {
            [ErrorSeverity.LOW]: "🌐 Network delay detected. Your request is being processed.",
            [ErrorSeverity.MEDIUM]: "❌ Connection issues. Please check your internet and try again.",
            [ErrorSeverity.HIGH]: "⚠️ Network connectivity problems. Please try again later.",
            [ErrorSeverity.CRITICAL]: "🚨 Severe network outage. Service unavailable."
        },
        [ErrorType.UNKNOWN_ERROR]: {
            [ErrorSeverity.LOW]: "❓ An unexpected issue occurred. Please try again.",
            [ErrorSeverity.MEDIUM]: "❌ Something went wrong. Our team has been notified.",
            [ErrorSeverity.HIGH]: "⚠️ Unexpected system behavior detected. Please contact Alexandre Bismuth (@alex_bsmth).",
            [ErrorSeverity.CRITICAL]: "🚨 Critical unknown error. Emergency procedures initiated."
        }
    };

    /**
     * Classify an error and provide structured information
     */
    static classifyError(error: any, context?: Record<string, any>): ErrorInfo {
        // Analyze the error to determine type and severity
        const classification = this.analyzeError(error);

        const userMessage = this.USER_FRIENDLY_MESSAGES[classification.type][classification.severity];
        const suggestedActions = this.getSuggestedActions(classification.type, classification.severity);

        return {
            type: classification.type,
            severity: classification.severity,
            userMessage,
            technicalMessage: this.extractTechnicalMessage(error),
            retryable: this.isRetryable(classification.type, classification.severity),
            context: context || {},
            suggestedActions
        };
    }

    /**
     * Analyze error to determine type and severity
     */
    private static analyzeError(error: any): { type: ErrorType; severity: ErrorSeverity } {
        if (!error) {
            return { type: ErrorType.UNKNOWN_ERROR, severity: ErrorSeverity.LOW };
        }

        // Handle string errors
        if (typeof error === 'string') {
            return this.classifyStringError(error);
        }

        // Handle Error objects
        if (error instanceof Error) {
            return this.classifyErrorObject(error);
        }

        // Handle AWS SDK errors
        if (error.code) {
            return this.classifyAWSError(error);
        }

        return { type: ErrorType.UNKNOWN_ERROR, severity: ErrorSeverity.MEDIUM };
    }

    /**
     * Classify string errors
     */
    private static classifyStringError(errorString: string): { type: ErrorType; severity: ErrorSeverity } {
        const lowerError = errorString.toLowerCase();

        if (lowerError.includes('authentication') || lowerError.includes('auth') || lowerError.includes('login')) {
            return { type: ErrorType.AUTHENTICATION_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        if (lowerError.includes('permission') || lowerError.includes('unauthorized') || lowerError.includes('admin')) {
            return { type: ErrorType.AUTHORIZATION_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        if (lowerError.includes('validation') || lowerError.includes('invalid') || lowerError.includes('format')) {
            return { type: ErrorType.VALIDATION_ERROR, severity: ErrorSeverity.LOW };
        }

        if (lowerError.includes('database') || lowerError.includes('dynamodb')) {
            return { type: ErrorType.DATABASE_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        if (lowerError.includes('too many failed attempts')) {
            return { type: ErrorType.AUTHENTICATION_ERROR, severity: ErrorSeverity.HIGH };
        }

        if (lowerError.includes('rate limit') || lowerError.includes('too many')) {
            return { type: ErrorType.RATE_LIMIT_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        if (lowerError.includes('timeout') || lowerError.includes('expired')) {
            return { type: ErrorType.TIMEOUT_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        return { type: ErrorType.UNKNOWN_ERROR, severity: ErrorSeverity.LOW };
    }

    /**
     * Classify Error objects
     */
    private static classifyErrorObject(error: Error): { type: ErrorType; severity: ErrorSeverity } {
        const message = error.message.toLowerCase();

        // Check for specific error patterns
        if (message.includes('too many failed attempts') || message.includes('blocked')) {
            return { type: ErrorType.AUTHENTICATION_ERROR, severity: ErrorSeverity.HIGH };
        }

        if (message.includes('insufficient privileges') || message.includes('admin access required')) {
            return { type: ErrorType.AUTHORIZATION_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        if (message.includes('network') || message.includes('econnreset') || message.includes('timeout')) {
            return { type: ErrorType.NETWORK_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        // Use string classification as fallback
        return this.classifyStringError(error.message);
    }

    /**
     * Classify AWS SDK errors
     */
    private static classifyAWSError(error: any): { type: ErrorType; severity: ErrorSeverity } {
        const { code } = error;

        // DynamoDB errors
        if (code === 'ProvisionedThroughputExceededException' || code === 'ThrottlingException') {
            return { type: ErrorType.DATABASE_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        if (code === 'ResourceNotFoundException') {
            return { type: ErrorType.DATABASE_ERROR, severity: ErrorSeverity.LOW };
        }

        if (code === 'ConditionalCheckFailedException') {
            return { type: ErrorType.VALIDATION_ERROR, severity: ErrorSeverity.LOW };
        }

        // SES errors
        if (code === 'Throttling' || code === 'SendingPausedException') {
            return { type: ErrorType.EXTERNAL_SERVICE_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        if (code === 'MessageRejected' || code === 'InvalidParameterValue') {
            return { type: ErrorType.VALIDATION_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        // Generic AWS errors
        if (code === 'ServiceUnavailable' || code === 'InternalServerError') {
            return { type: ErrorType.EXTERNAL_SERVICE_ERROR, severity: ErrorSeverity.HIGH };
        }

        if (code === 'RequestTimeout' || code === 'NetworkingError') {
            return { type: ErrorType.NETWORK_ERROR, severity: ErrorSeverity.MEDIUM };
        }

        return { type: ErrorType.EXTERNAL_SERVICE_ERROR, severity: ErrorSeverity.MEDIUM };
    }

    /**
     * Extract technical message from error
     */
    private static extractTechnicalMessage(error: any): string {
        if (typeof error === 'string') {
            return error;
        }

        if (error instanceof Error) {
            return `${error.name}: ${error.message}`;
        }

        if (error.code && error.message) {
            return `${error.code}: ${error.message}`;
        }

        return JSON.stringify(error);
    }

    /**
     * Determine if error is retryable
     */
    private static isRetryable(type: ErrorType, severity: ErrorSeverity): boolean {
        // Never retry critical errors
        if (severity === ErrorSeverity.CRITICAL) {
            return false;
        }

        // Specific retry rules by error type
        switch (type) {
            case ErrorType.DATABASE_ERROR:
            case ErrorType.EXTERNAL_SERVICE_ERROR:
            case ErrorType.NETWORK_ERROR:
                return severity !== ErrorSeverity.HIGH;

            case ErrorType.RATE_LIMIT_ERROR:
                return severity === ErrorSeverity.LOW;

            case ErrorType.TIMEOUT_ERROR:
                return severity === ErrorSeverity.LOW;

            case ErrorType.AUTHENTICATION_ERROR:
            case ErrorType.AUTHORIZATION_ERROR:
            case ErrorType.VALIDATION_ERROR:
                return false;

            default:
                return severity === ErrorSeverity.LOW;
        }
    }

    /**
     * Get suggested actions for error recovery
     */
    private static getSuggestedActions(type: ErrorType, severity: ErrorSeverity): string[] {
        switch (type) {
            case ErrorType.AUTHENTICATION_ERROR:
                if (severity === ErrorSeverity.HIGH || severity === ErrorSeverity.CRITICAL) {
                    return ["Wait for the block to expire", "Contact Alexandre Bismuth (@alex_bsmth) if the issue persists"];
                }
                return ["Use /auth to authenticate", "Check your @polytechnique.edu email", "Verify the code in your email"];

            case ErrorType.AUTHORIZATION_ERROR:
                return ["Contact an administrator", "Verify your account privileges", "Check if you're using the correct account"];

            case ErrorType.VALIDATION_ERROR:
                return ["Check the input format", "Review the requirements", "Try with different values"];

            case ErrorType.DATABASE_ERROR:
                if (severity === ErrorSeverity.LOW || severity === ErrorSeverity.MEDIUM) {
                    return ["Wait a moment and try again", "Retry your last action"];
                }
                return ["Wait for system recovery", "Contact Alexandre Bismuth (@alex_bsmth) if issues persist"];

            case ErrorType.EXTERNAL_SERVICE_ERROR:
                return ["Try again in a few minutes", "Check your email for delayed messages", "Contact Alexandre Bismuth (@alex_bsmth) if needed"];

            case ErrorType.RATE_LIMIT_ERROR:
                return ["Wait before sending another message", "Use the bot more mindfully", "Check back tomorrow if daily limit exceeded"];

            case ErrorType.TIMEOUT_ERROR:
                return ["Continue interacting to maintain session", "Re-authenticate with /auth", "Start a new session"];

            case ErrorType.NETWORK_ERROR:
                return ["Check your internet connection", "Try again in a moment", "Contact Alexandre Bismuth (@alex_bsmth) if problem persists"];

            default:
                return ["Try again", "Contact Alexandre Bismuth (@alex_bsmth) if the issue continues"];
        }
    }

    /**
     * Create fallback response when services are unavailable
     */
    static createFallbackResponse(context?: {
        action?: string;
        state?: ConversationState;
        userId?: string
    }): string {
        const baseMessage = "🚧 **System Maintenance**\n\n" +
            "Some services are temporarily unavailable. We're working to resolve this quickly.\n\n";

        if (context?.action) {
            return baseMessage +
                `Your "${context.action}" request has been noted and will be processed once services are restored.\n\n` +
                "💡 **What you can do:**\n" +
                "• Try again in a few minutes\n" +
                "• Use /help for available commands\n" +
                "• Contact Alexandre Bismuth (@alex_bsmth) if urgent";
        }

        return baseMessage +
            "💡 **Available options:**\n" +
            "• Basic commands may still work\n" +
            "• Check back in a few minutes\n" +
            "• Use /status for system updates";
    }

    /**
     * Format error for logging
     */
    static formatForLogging(error: any, context?: Record<string, any>): Record<string, any> {
        const errorInfo = this.classifyError(error, context);

        return {
            timestamp: new Date().toISOString(),
            errorType: errorInfo.type,
            severity: errorInfo.severity,
            technicalMessage: errorInfo.technicalMessage,
            retryable: errorInfo.retryable,
            context: errorInfo.context,
            stack: error instanceof Error ? error.stack : undefined,
        };
    }
}
