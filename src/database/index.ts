// Database layer exports
export { DynamoDBClient } from './client';
export {
  TABLE_NAMES,
  ALL_TABLE_SCHEMAS,
  USERS_TABLE_SCHEMA,
  COURSES_TABLE_SCHEMA,
  REVIEWS_TABLE_SCHEMA,
  VOTES_TABLE_SCHEMA,
  RATE_LIMITS_TABLE_SCHEMA,
  TableManager
} from './schemas';

// Repository exports
export { BaseRepository, AbstractRepository, ListOptions } from './repositories/base';
export { UserRepository, User } from './repositories/user';
export { CourseRepository, Course, GradingScheme, GradingComponent, AverageRatings } from './repositories/course';
export { ReviewRepository, Review, ReviewRatings, ReviewWithVotes } from './repositories/review';
export { VoteRepository, Vote } from './repositories/vote';