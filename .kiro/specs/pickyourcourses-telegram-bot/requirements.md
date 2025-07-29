# Requirements Document

## Introduction

PickYourCourses is a Telegram bot designed for École Polytechnique students to share and read course reviews. The bot provides a comprehensive course review system with ratings and detailed reviews. The system categorizes courses into academic departments and allows students to make informed decisions about their course selections.

## Requirements

### Requirement 1

**User Story:** As a student, I want to post course reviews with three different rating categories, so that I can share my comprehensive experience with other students. I should also optionally be able to add detailed written feedback about a course.

#### Acceptance Criteria

1. WHEN a user selects "post review" THEN the system SHALL display the list of course categories
2. WHEN a user selects a category THEN the system SHALL display all courses in that category
3. WHEN a user selects a course THEN the system SHALL prompt for three ratings: overall, quality, and difficulty
4. WHEN providing ratings THEN the system SHALL accept 1-5 star emoji ratings for each category
5. WHEN ratings are provided THEN the system SHALL optionally prompt for a detailed written review
6. WHEN submitting a review THEN the system SHALL ask if the user wants to remain anonymous
7. WHEN a review is submitted THEN the system SHALL save it with timestamp and user information
8. WHEN a user tries to review the same course twice THEN the system SHALL allow updating their existing review

### Requirement 2

**User Story:** As a student, I want to read course reviews with average ratings and detailed feedback, so that I can make informed decisions about course selection.

#### Acceptance Criteria

1. WHEN a user selects "read reviews" THEN the system SHALL display the list of course categories
2. WHEN a user selects a category THEN the system SHALL display all courses with their average ratings
3. WHEN a user selects a course THEN the system SHALL display average ratings for all three categories
4. WHEN viewing a course THEN the system SHALL show all detailed reviews sorted by upvotes
5. WHEN viewing reviews THEN the system SHALL display upvote/downvote counts for each review
6. WHEN a user clicks thumbs up/down THEN the system SHALL record their vote and update the count
7. WHEN a user tries to vote twice on the same review THEN the system SHALL replace their previous vote

### Requirement 3

**User Story:** As a student, I want to see courses organized by academic categories, so that I can easily navigate to relevant courses for my studies.

#### Acceptance Criteria

1. WHEN accessing course categories THEN the system SHALL display first page with MAA, PHY, CSE, ECO, LAB
2. WHEN accessing course categories THEN the system SHALL provide navigation to second page with HSS, PDV, BIO, CHEM, SPOFAL, PRL
3. WHEN selecting a category THEN the system SHALL display all courses within that category
4. WHEN viewing courses in a category THEN the system SHALL show course codes and names
5. WHEN no courses exist in a category THEN the system SHALL display an appropriate message

### Requirement 4

**User Story:** As a student, I want to view and modify course grading schemes, so that accurate grading information is available for decision-making.

#### Acceptance Criteria

1. WHEN viewing a course THEN the system SHALL display the current grading scheme
2. WHEN a user selects "modify grading scheme" THEN the system SHALL allow editing of grade components and percentages
3. WHEN modifying grading scheme THEN the system SHALL validate that percentages sum to 100%
4. WHEN grading scheme is updated THEN the system SHALL save changes with timestamp and user information
5. WHEN viewing grading history THEN the system SHALL show previous modifications and who made them

### Requirement 5

**User Story:** As a system operator, I want the bot to run efficiently on AWS Lambda with 100% uptime, so that it can handle user requests reliably and cost-effectively.

#### Acceptance Criteria

1. WHEN the bot receives a message THEN the system SHALL respond within 3 seconds
2. WHEN Lambda function is invoked THEN the system SHALL handle concurrent users up to 100 simultaneous connections
3. WHEN storing data THEN the system SHALL use appropriate AWS services for persistence
4. WHEN errors occur THEN the system SHALL log them appropriately for debugging
5. WHEN the bot is idle THEN the system SHALL minimize resource usage to reduce costs

### Requirement 6

**User Story:** As a user, I want the bot to provide clear navigation and error handling, so that I can use it intuitively without confusion.

#### Acceptance Criteria

1. WHEN a user sends an invalid command THEN the system SHALL provide helpful error messages and suggest valid options
2. WHEN navigating menus THEN the system SHALL provide "back" and "main menu" options
3. WHEN a user is inactive for 10 minutes THEN the system SHALL send a timeout warning
4. WHEN a user is inactive for 15 minutes THEN the system SHALL end the session
5. WHEN displaying long lists THEN the system SHALL implement pagination with navigation controls
6. WHEN errors occur THEN the system SHALL provide user-friendly messages without exposing technical details
