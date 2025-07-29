# Implementation Plan

- [x] 1. Set up project structure and core interfaces
  - Create directory structure for services, models, handlers, and utilities
  - Define TypeScript interfaces for all data models (Course, Review, Vote, Session, RateLimit, GradingScheme)
  - Set up package.json with required dependencies (aws-sdk, node-telegram-bot-api, typescript)
  - Configure TypeScript compiler settings and build scripts
  - _Requirements: 5.1, 5.2_

- [x] 2. Implement DynamoDB data layer
  - [x] 2.1 Create DynamoDB table schemas and connection utilities
    - Write DynamoDB client configuration with proper AWS credentials handling
    - Define table schemas for Courses, Reviews, Votes, Sessions, RateLimit tables
    - Implement connection pooling and error handling for database operations
    - Create unit tests for database connection and basic operations
    - _Requirements: 5.3, 5.4_

  - [x] 2.2 Implement repository pattern for data access
    - Create base repository interface with CRUD operations
    - Implement CourseRepository with category filtering and average rating calculations
    - Implement ReviewRepository with voting and sorting capabilities
    - Create unit tests for all repository operations
    - _Requirements: 1.7, 2.4, 2.5_

- [x] 3. Implement rate limiting system
  - [x] 3.1 Create rate limiting service
    - Implement RateLimitService with daily and total message counting
    - Add logic for midnight UTC reset of daily counters
    - Write unit tests for rate limiting logic including edge cases
    - _Requirements: Custom rate limiting requirement_

  - [x] 3.2 Integrate rate limiting with message handling
    - Add rate limit checks to webhook handler before processing messages
    - Implement appropriate error responses when limits are exceeded
    - Create logging for rate limit violations
    - Write integration tests for rate limiting in message flow
    - _Requirements: Custom rate limiting requirement_

- [x] 4. Implement course management system
  - [x] 4.1 Create course service with category management
    - Implement CourseService with methods for category-based course retrieval
    - Add support for the two-page category system (MAA, PHY, CSE, ECO, LAB / HSS, PDV, BIO, CHEM, SPOFAL, PRL)
    - Implement course details retrieval with average ratings calculation
    - Write unit tests for course categorization and retrieval
    - _Requirements: 3.1, 3.2, 3.3, 3.4_

  - [x] 4.2 Implement grading scheme management
    - Create grading scheme CRUD operations with validation (percentages must sum to 100%)
    - Implement grading scheme history tracking with user attribution
    - Add modification audit trail for visibility
    - Write unit tests for grading scheme validation and history tracking
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5_

- [x] 5. Implement review system
  - [x] 5.1 Create review posting functionality
    - Implement ReviewService with three-category rating system (overall, quality, difficulty)
    - Add support for optional detailed text reviews and anonymity settings
    - Implement review update functionality for existing user reviews
    - Write unit tests for review creation and validation
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 5.2 Implement review retrieval and voting system
    - Create review retrieval with sorting by upvotes
    - Implement upvote/downvote functionality with vote tracking per user
    - Add logic to prevent duplicate voting and allow vote changes
    - Calculate and display average ratings for courses
    - Write unit tests for voting logic and review sorting
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 6. Implement state management system
  - [x] 6.1 Create conversation state manager
    - Implement StateManager class with state persistence in DynamoDB
    - Define all conversation states (MAIN_MENU, BROWSING_CATEGORIES, VIEWING_COURSE, POSTING_REVIEW, etc.)
    - Add state transition logic and validation
    - Write unit tests for state management and transitions
    - _Requirements: 6.1, 6.2_

  - [x] 6.2 Implement session timeout handling
    - Add 10-minute inactivity warning system
    - Implement 15-minute session timeout with automatic cleanup
    - Create session renewal logic for active users
    - Write unit tests for timeout handling and session cleanup
    - _Requirements: 6.3, 6.4_

- [x] 7. Create Telegram bot interface
  - [x] 7.1 Implement webhook handler and message routing
    - Create main webhook handler for processing Telegram updates
    - Implement message parsing and command routing logic
    - Add callback query handling for inline keyboards
    - Write unit tests for message parsing and routing
    - _Requirements: 5.1, 6.1_

  - [x] 7.2 Create user interface components
    - Implement inline keyboard generation for navigation menus
    - Create pagination system for long lists (courses, reviews)
    - Add "back" and "main menu" navigation options throughout the interface
    - Write unit tests for UI component generation
    - _Requirements: 6.2, 6.5_

- [x] 8. Implement main bot workflows
  - [x] 8.1 Implement review posting workflow
    - Create step-by-step review posting interface (category → course → ratings → text → anonymity)
    - Add validation and confirmation steps for review submission
    - Implement review update workflow for existing reviews
    - Write integration tests for complete review posting flow
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8_

  - [x] 8.2 Implement review reading workflow
    - Create course browsing interface with category navigation
    - Implement review display with voting buttons and sorting options
    - Add course details view with average ratings and grading scheme
    - Write integration tests for review browsing and voting
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7_

- [x] 9. Implement error handling and user experience
  - [x] 9.1 Create comprehensive error handling
    - Implement user-friendly error messages for all failure scenarios
    - Add retry logic for transient failures (DynamoDB throttling)
    - Create fallback responses when services are unavailable
    - Write unit tests for error handling scenarios
    - _Requirements: 6.1, 6.6_

  - [x] 9.2 Add logging and monitoring
    - Implement structured logging for all operations using CloudWatch
    - Add performance metrics tracking (response times, error rates)
    - Create alerts for critical failures and rate limit violations
    - Write tests for logging functionality
    - _Requirements: 5.4_

- [x] 10. AWS Lambda deployment setup
  - [x] 10.1 Create Lambda function configuration
    - Set up serverless.yml or AWS CDK configuration for Lambda deployment
    - Configure environment variables for bot token, DynamoDB table names
    - Set up IAM roles and policies for DynamoDB access
    - Configure API Gateway webhook endpoint with proper security
    - _Requirements: 5.1, 5.2, 5.3_

  - [x] 10.2 Optimize for Lambda environment
    - Implement connection reuse and warm-up strategies
    - Add Lambda-specific error handling and timeout management
    - Configure memory and timeout settings based on performance testing
    - Create deployment scripts and CI/CD pipeline configuration
    - _Requirements: 5.1, 5.2_

- [x] 11. Testing and quality assurance
  - [x] 11.1 Create comprehensive test suite
    - Write unit tests for all services achieving >90% code coverage
    - Create integration tests for database operations
    - Implement end-to-end tests for complete user workflows
    - Add load testing for concurrent user scenarios
    - _Requirements: All requirements need testing coverage_

  - [x] 11.2 Security and performance testing
    - Implement input validation tests to prevent injection attacks
    - Test rate limiting effectiveness
    - Perform load testing with 100 concurrent users
    - Validate data privacy for anonymous reviews
    - _Requirements: 5.2, Custom rate limiting requirement_
