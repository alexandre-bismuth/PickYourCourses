import {
  APIGatewayProxyEvent,
  APIGatewayProxyResult,
  Context,
} from "aws-lambda";
import { ServiceFactory } from "./utils/ServiceFactory";

/**
 * Lambda handler for Telegram webhook
 */
export const webhookHandler = async (
  event: APIGatewayProxyEvent,
  context: Context
): Promise<APIGatewayProxyResult> => {
  try {
    console.log("Webhook request received", {
      requestId: context.awsRequestId,
      httpMethod: event.httpMethod,
      path: event.path,
      remainingTime: context.getRemainingTimeInMillis(),
    });

    // Validate request method
    if (event.httpMethod !== "POST") {
      console.warn("Invalid HTTP method", {
        method: event.httpMethod,
        requestId: context.awsRequestId,
      });

      return {
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
    }

    // Parse request body
    if (!event.body) {
      console.warn("Empty request body", {
        requestId: context.awsRequestId,
      });

      return {
        statusCode: 400,
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          error: "Bad request",
          message: "Empty request body",
        }),
      };
    }

    // Initialize services using factory (with connection reuse)
    const services = await ServiceFactory.createServices();

    // Use the WebhookHandler's handleWebhook method directly
    const result = await services.webhookHandler.handleWebhook(event);

    console.log("Webhook request processed successfully", {
      statusCode: result.statusCode,
      requestId: context.awsRequestId,
      remainingTime: context.getRemainingTimeInMillis(),
    });

    return result;
  } catch (error) {
    console.error("Webhook request failed", error, {
      requestId: context.awsRequestId,
      body: event.body?.substring(0, 500),
      remainingTime: context.getRemainingTimeInMillis(),
    });

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        message: "Internal server error",
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
  try {
    // Check environment variables
    const envCheck = {
      telegramBotToken: !!process.env["TELEGRAM_BOT_TOKEN"],
      dynamodbTablePrefix: !!process.env["DYNAMODB_TABLE_PREFIX"],
      stage: process.env["STAGE"] || "unknown",
    };

    const healthStatus = {
      status: "healthy",
      timestamp: new Date().toISOString(),
      version: process.env["npm_package_version"] || "1.0.0",
      environment: envCheck,
      lambda: {
        functionName: context.functionName,
        functionVersion: context.functionVersion,
        memoryLimitInMB: context.memoryLimitInMB,
        remainingTimeInMillis: context.getRemainingTimeInMillis(),
      },
    };

    console.log("Health check completed", {
      status: "healthy",
      requestId: context.awsRequestId,
    });

    return {
      statusCode: 200,
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      },
      body: JSON.stringify(healthStatus, null, 2),
    };
  } catch (error) {
    console.error("Health check failed", error, {
      requestId: context.awsRequestId,
    });

    return {
      statusCode: 500,
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        status: "unhealthy",
        error: String(error),
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
    console.log("Lambda warm-up initiated", {
      requestId: context.awsRequestId,
      remainingTime: context.getRemainingTimeInMillis(),
    });

    try {
      // Pre-initialize services
      await ServiceFactory.createServices();

      console.log("Lambda warm-up completed successfully", {
        requestId: context.awsRequestId,
        remainingTime: context.getRemainingTimeInMillis(),
      });
    } catch (error) {
      console.error("Lambda warm-up failed", error, {
        requestId: context.awsRequestId,
      });
      throw error;
    }
  }
};
