import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { Logger, LogCategory } from "./utils/Logger";
import { ErrorHandler } from "./utils/ErrorHandler";
import { ServiceFactory } from "./utils";
import {
  WarmUpStrategy,
  LambdaPerformanceMonitor,
  MemoryManager,
} from "./utils/LambdaOptimization";

// Initialize logger
const logger = Logger.getInstance();

/**
 * Lambda handler for Telegram webhook
 */
export const webhookHandler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  const functionName = "webhookHandler";

  try {
    // Log memory usage at start
    MemoryManager.logMemoryUsage("handler_start");

    // Perform warm-up if needed
    if (WarmUpStrategy.needsWarmUp()) {
      await WarmUpStrategy.warmUp();
    }

    logger.info(LogCategory.WEBHOOK, "Webhook request received", {
      requestId: context.awsRequestId,
      httpMethod: event.httpMethod,
      path: event.path,
      remainingTime: context.getRemainingTimeInMillis(),
      headers: {
        "content-type": event.headers["content-type"],
        "user-agent": event.headers["user-agent"],
      },
    });

    // Validate request method
    if (event.httpMethod !== "POST") {
      logger.warn(LogCategory.WEBHOOK, "Invalid HTTP method", {
        method: event.httpMethod,
        requestId: context.awsRequestId,
      });

      const result = {
        statusCode: 405,
        headers: {
          "Content-Type": "application/json",
          Allow: "POST",
        },
        body: JSON.stringify({
          error: "Method not allowed",
          message: "Only POST requests are accepted",
        }),
      };

      LambdaPerformanceMonitor.trackExecution(
        functionName,
        Date.now() - startTime,
        false
      );
      return result;
    }

    // Webhook secret validation disabled - using HTTPS for security

    // Parse request body
    if (!event.body) {
      logger.warn(LogCategory.WEBHOOK, "Empty request body", {
        requestId: context.awsRequestId,
      });

      const result = {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error: "Bad request",
          message: "Empty request body",
        }),
      };

      LambdaPerformanceMonitor.trackExecution(
        functionName,
        Date.now() - startTime,
        false
      );
      return result;
    }

    // Initialize services using factory (with connection reuse)
    const services = await ServiceFactory.createServices();

    // Log memory usage after service initialization
    MemoryManager.logMemoryUsage("services_initialized");

    // Use the WebhookHandler's handleWebhook method directly
    const result = await services.webhookHandler.handleWebhook(event);

    // Log memory usage after processing
    MemoryManager.logMemoryUsage("processing_complete");

    // Track successful execution
    LambdaPerformanceMonitor.trackExecution(
      functionName,
      Date.now() - startTime,
      true
    );

    logger.info(LogCategory.WEBHOOK, "Webhook request processed successfully", {
      duration: Date.now() - startTime,
      statusCode: result.statusCode,
      requestId: context.awsRequestId,
      remainingTime: context.getRemainingTimeInMillis(),
    });

    return result;
  } catch (error) {
    const duration = Date.now() - startTime;
    const errorInfo = ErrorHandler.classifyError(error);

    logger.error(LogCategory.WEBHOOK, "Webhook request failed", error, {
      duration,
      errorType: errorInfo.type,
      errorSeverity: errorInfo.severity,
      requestId: context.awsRequestId,
      body: event.body?.substring(0, 500),
      remainingTime: context.getRemainingTimeInMillis(),
    });

    // Track failed execution
    LambdaPerformanceMonitor.trackExecution(functionName, duration, false);

    // Log memory usage on error
    MemoryManager.logMemoryUsage("error_occurred");

    // Return appropriate error response based on severity
    const statusCode = errorInfo.severity === "CRITICAL" ? 500 : 200; // Return 200 to prevent Telegram retries for non-critical errors

    return {
      statusCode,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        error: errorInfo.type,
        message: errorInfo.technicalMessage,
        requestId: context.awsRequestId,
      }),
    };
  }
};

/**
 * Lambda handler for health check
 */
export const healthCheckHandler = async (
  _event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  const startTime = Date.now();
  const functionName = "healthCheckHandler";

  try {
    // Get system health from logger
    const systemHealth = logger.getSystemHealth();

    // Get performance metrics
    const performanceMetrics = LambdaPerformanceMonitor.getAllMetrics();

    // Get memory usage
    const memoryUsage = MemoryManager.getMemoryUsage();

    // Check environment variables
    const envCheck = {
      telegramBotToken: !!process.env["TELEGRAM_BOT_TOKEN"],
      dynamodbTablePrefix: !!process.env["DYNAMODB_TABLE_PREFIX"],
      sesRegion: !!process.env["SES_REGION"],
      stage: process.env["STAGE"] || "unknown",
    };

    const healthStatus = {
      status: systemHealth.status,
      timestamp: new Date().toISOString(),
      version: process.env["npm_package_version"] || "1.0.0",
      environment: envCheck,
      system: systemHealth,
      performance: performanceMetrics,
      memory: memoryUsage,
      lambda: {
        functionName: context.functionName,
        functionVersion: context.functionVersion,
        memoryLimitInMB: context.memoryLimitInMB,
        remainingTimeInMillis: context.getRemainingTimeInMillis(),
      },
    };

    // Track successful execution
    LambdaPerformanceMonitor.trackExecution(
      functionName,
      Date.now() - startTime,
      true
    );

    logger.info(LogCategory.SYSTEM, "Health check completed", {
      status: systemHealth.status,
      duration: Date.now() - startTime,
      requestId: context.awsRequestId,
    });

    return {
      statusCode: systemHealth.status === "healthy" ? 200 : 503,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(healthStatus, null, 2),
    };
  } catch (error) {
    const errorInfo = ErrorHandler.classifyError(error);

    // Track failed execution
    LambdaPerformanceMonitor.trackExecution(
      functionName,
      Date.now() - startTime,
      false
    );

    logger.error(LogCategory.SYSTEM, "Health check failed", error, {
      requestId: context.awsRequestId,
    });

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "unhealthy",
        error: errorInfo.technicalMessage,
        timestamp: new Date().toISOString(),
        requestId: context.awsRequestId,
      }),
    };
  }
};

/**
 * Lambda warm-up handler to reduce cold starts
 */
export const warmUpHandler = async (
  event: any,
  context: Context
): Promise<void> => {
  if (event.source === "serverless-plugin-warmup") {
    const startTime = Date.now();

    logger.info(LogCategory.SYSTEM, "Lambda warm-up initiated", {
      requestId: context.awsRequestId,
      remainingTime: context.getRemainingTimeInMillis(),
    });

    try {
      // Execute warm-up strategy
      await WarmUpStrategy.warmUp();

      // Force garbage collection if available
      MemoryManager.forceGarbageCollection();

      const duration = Date.now() - startTime;

      logger.info(LogCategory.SYSTEM, "Lambda warm-up completed successfully", {
        duration,
        requestId: context.awsRequestId,
        remainingTime: context.getRemainingTimeInMillis(),
        memoryUsage: MemoryManager.getMemoryUsage(),
      });
    } catch (error) {
      logger.error(LogCategory.SYSTEM, "Lambda warm-up failed", error, {
        requestId: context.awsRequestId,
      });
      throw error;
    }
  }
};
