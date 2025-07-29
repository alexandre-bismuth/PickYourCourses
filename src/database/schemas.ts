import { DynamoDB } from 'aws-sdk';

/**
 * DynamoDB table schemas for the PickYourCourses bot
 */

const TABLE_PREFIX = process.env['DYNAMODB_TABLE_PREFIX'] || 'pickyourcourses';

export const TABLE_NAMES = {
  USERS: `${TABLE_PREFIX}-users`,
  COURSES: `${TABLE_PREFIX}-courses`,
  REVIEWS: `${TABLE_PREFIX}-reviews`,
  VOTES: `${TABLE_PREFIX}-votes`,
  RATE_LIMITS: `${TABLE_PREFIX}-rate-limit`,
  GRADING_HISTORY: `${TABLE_PREFIX}-grading-history`
};

/**
 * Users table schema
 */
export const USERS_TABLE_SCHEMA: DynamoDB.CreateTableInput = {
  TableName: TABLE_NAMES.USERS,
  KeySchema: [
    {
      AttributeName: 'telegramId',
      KeyType: 'HASH'
    }
  ],
  AttributeDefinitions: [
    {
      AttributeName: 'telegramId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'email',
      AttributeType: 'S'
    }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'EmailIndex',
      KeySchema: [
        {
          AttributeName: 'email',
          KeyType: 'HASH'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  BillingMode: 'PAY_PER_REQUEST'
};

/**
 * Courses table schema
 */
export const COURSES_TABLE_SCHEMA: DynamoDB.CreateTableInput = {
  TableName: TABLE_NAMES.COURSES,
  KeySchema: [
    {
      AttributeName: 'courseId',
      KeyType: 'HASH'
    }
  ],
  AttributeDefinitions: [
    {
      AttributeName: 'courseId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'category',
      AttributeType: 'S'
    }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'CategoryIndex',
      KeySchema: [
        {
          AttributeName: 'category',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'courseId',
          KeyType: 'RANGE'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  BillingMode: 'PAY_PER_REQUEST'
};

/**
 * Reviews table schema
 */
export const REVIEWS_TABLE_SCHEMA: DynamoDB.CreateTableInput = {
  TableName: TABLE_NAMES.REVIEWS,
  KeySchema: [
    {
      AttributeName: 'reviewId',
      KeyType: 'HASH'
    }
  ],
  AttributeDefinitions: [
    {
      AttributeName: 'reviewId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'courseId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'userId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'createdAt',
      AttributeType: 'S'
    }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'CourseIndex',
      KeySchema: [
        {
          AttributeName: 'courseId',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'createdAt',
          KeyType: 'RANGE'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    },
    {
      IndexName: 'UserIndex',
      KeySchema: [
        {
          AttributeName: 'userId',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'createdAt',
          KeyType: 'RANGE'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  BillingMode: 'PAY_PER_REQUEST'
};

/**
 * Votes table schema
 */
export const VOTES_TABLE_SCHEMA: DynamoDB.CreateTableInput = {
  TableName: TABLE_NAMES.VOTES,
  KeySchema: [
    {
      AttributeName: 'voteId',
      KeyType: 'HASH'
    }
  ],
  AttributeDefinitions: [
    {
      AttributeName: 'voteId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'reviewId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'userId',
      AttributeType: 'S'
    }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'ReviewIndex',
      KeySchema: [
        {
          AttributeName: 'reviewId',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'userId',
          KeyType: 'RANGE'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    },
    {
      IndexName: 'UserIndex',
      KeySchema: [
        {
          AttributeName: 'userId',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'reviewId',
          KeyType: 'RANGE'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  BillingMode: 'PAY_PER_REQUEST'
};

/**
 * Rate Limits table schema
 */
export const RATE_LIMITS_TABLE_SCHEMA: DynamoDB.CreateTableInput = {
  TableName: TABLE_NAMES.RATE_LIMITS,
  KeySchema: [
    {
      AttributeName: 'userId',
      KeyType: 'HASH'
    }
  ],
  AttributeDefinitions: [
    {
      AttributeName: 'userId',
      AttributeType: 'S'
    }
  ],
  BillingMode: 'PAY_PER_REQUEST'
};

/**
 * Grading History table schema
 */
export const GRADING_HISTORY_TABLE_SCHEMA: DynamoDB.CreateTableInput = {
  TableName: TABLE_NAMES.GRADING_HISTORY,
  KeySchema: [
    {
      AttributeName: 'historyId',
      KeyType: 'HASH'
    }
  ],
  AttributeDefinitions: [
    {
      AttributeName: 'historyId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'courseId',
      AttributeType: 'S'
    },
    {
      AttributeName: 'modifiedAt',
      AttributeType: 'S'
    }
  ],
  GlobalSecondaryIndexes: [
    {
      IndexName: 'CourseIndex',
      KeySchema: [
        {
          AttributeName: 'courseId',
          KeyType: 'HASH'
        },
        {
          AttributeName: 'modifiedAt',
          KeyType: 'RANGE'
        }
      ],
      Projection: {
        ProjectionType: 'ALL'
      },
      ProvisionedThroughput: {
        ReadCapacityUnits: 5,
        WriteCapacityUnits: 5
      }
    }
  ],
  BillingMode: 'PAY_PER_REQUEST'
};

/**
 * All table schemas for easy iteration
 */
export const ALL_TABLE_SCHEMAS = [
  USERS_TABLE_SCHEMA,
  COURSES_TABLE_SCHEMA,
  REVIEWS_TABLE_SCHEMA,
  VOTES_TABLE_SCHEMA,
  RATE_LIMITS_TABLE_SCHEMA,
  GRADING_HISTORY_TABLE_SCHEMA
];

/**
 * Table creation utility
 */
export class TableManager {
  private dynamoDB: DynamoDB;

  constructor(dynamoDB: DynamoDB) {
    this.dynamoDB = dynamoDB;
  }

  /**
   * Create a single table
   */
  async createTable(schema: DynamoDB.CreateTableInput): Promise<void> {
    try {
      await this.dynamoDB.createTable(schema).promise();
      console.log(`Table ${schema.TableName} created successfully`);
    } catch (error: any) {
      if (error.code === 'ResourceInUseException') {
        console.log(`Table ${schema.TableName} already exists`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Create all tables
   */
  async createAllTables(): Promise<void> {
    for (const schema of ALL_TABLE_SCHEMAS) {
      await this.createTable(schema);
    }
  }

  /**
   * Delete a single table
   */
  async deleteTable(tableName: string): Promise<void> {
    try {
      await this.dynamoDB.deleteTable({ TableName: tableName }).promise();
      console.log(`Table ${tableName} deleted successfully`);
    } catch (error: any) {
      if (error.code === 'ResourceNotFoundException') {
        console.log(`Table ${tableName} does not exist`);
      } else {
        throw error;
      }
    }
  }

  /**
   * Delete all tables
   */
  async deleteAllTables(): Promise<void> {
    for (const tableName of Object.values(TABLE_NAMES)) {
      await this.deleteTable(tableName);
    }
  }

  /**
   * Check if table exists
   */
  async tableExists(tableName: string): Promise<boolean> {
    try {
      await this.dynamoDB.describeTable({ TableName: tableName }).promise();
      return true;
    } catch (error: any) {
      if (error.code === 'ResourceNotFoundException') {
        return false;
      }
      throw error;
    }
  }

  /**
   * Wait for table to be active
   */
  async waitForTableActive(tableName: string): Promise<void> {
    await this.dynamoDB.waitFor('tableExists', { TableName: tableName }).promise();
  }
}