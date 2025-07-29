import { DynamoDB } from 'aws-sdk';
import { DocumentClient } from 'aws-sdk/clients/dynamodb';

/**
 * DynamoDB client configuration with connection pooling and error handling
 */
export class DynamoDBClient {
  private static instance: DynamoDBClient;
  private documentClient: DocumentClient;
  private dynamoDB: DynamoDB;

  private constructor() {
    // Configure DynamoDB client with connection pooling
    const config: DynamoDB.ClientConfiguration = {
      region: process.env['AWS_REGION'] || 'us-east-1',
      maxRetries: 3,
      retryDelayOptions: {
        customBackoff: (retryCount: number) => Math.pow(2, retryCount) * 100
      },
      httpOptions: {
        connectTimeout: 5000,
        timeout: 10000
      }
    };

    this.dynamoDB = new DynamoDB(config);
    this.documentClient = new DocumentClient({
      ...config,
      convertEmptyValues: true
    });
  }

  /**
   * Get singleton instance of DynamoDB client
   */
  public static getInstance(): DynamoDBClient {
    if (!DynamoDBClient.instance) {
      DynamoDBClient.instance = new DynamoDBClient();
    }
    return DynamoDBClient.instance;
  }

  /**
   * Get DocumentClient for data operations
   */
  public getDocumentClient(): DocumentClient {
    return this.documentClient;
  }

  /**
   * Get DynamoDB client for table operations
   */
  public getDynamoDB(): DynamoDB {
    return this.dynamoDB;
  }

  /**
   * Test database connection
   */
  public async testConnection(): Promise<boolean> {
    try {
      await this.dynamoDB.listTables().promise();
      return true;
    } catch (error) {
      console.error('DynamoDB connection test failed:', error);
      return false;
    }
  }

  /**
   * Handle DynamoDB errors with proper error classification
   */
  public handleError(error: any): Error {
    if (error.code === 'ResourceNotFoundException') {
      return new Error(`Table not found: ${error.message}`);
    }
    
    if (error.code === 'ValidationException') {
      return new Error(`Validation error: ${error.message}`);
    }
    
    if (error.code === 'ConditionalCheckFailedException') {
      return new Error(`Conditional check failed: ${error.message}`);
    }
    
    if (error.code === 'ProvisionedThroughputExceededException') {
      return new Error(`Throughput exceeded: ${error.message}`);
    }
    
    if (error.code === 'ThrottlingException') {
      return new Error(`Request throttled: ${error.message}`);
    }
    
    return new Error(`DynamoDB error: ${error.message || error}`);
  }
}

export default DynamoDBClient;