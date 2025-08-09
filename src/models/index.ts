/**
 * Data model interfaces for the PickYourCourses Telegram bot
 */

export interface User {
  telegramId: string; // Primary key
  email: string;
  name?: string; // Full name for public reviews
  promotion?: string; // Promotion/year for public reviews
  createdAt: string;
  lastActive: string;
}

export interface Course {
  courseId: string; // Primary key (e.g., "MAA101")
  category: string; // MAA, PHY, CSE, etc.
  name: string;
  description?: string;
  gradingScheme: GradingScheme;
  averageRatings: {
    overall: number;
    quality: number;
    difficulty: number;
  };
  reviewCount: number;
}

export interface Review {
  reviewId: string; // Primary key
  courseId: string; // GSI
  userId: string;
  ratings: {
    overall: number; // 1-5
    quality: number; // 1-5
    difficulty: number; // 1-5
  };
  text?: string;
  anonymous: boolean;
  upvotes: number;
  downvotes: number;
  createdAt: string;
  updatedAt: string;
  isDeleted: boolean;
}

export interface Vote {
  voteId: string; // Primary key
  reviewId: string; // GSI
  userId: string;
  voteType: 'up' | 'down';
  createdAt: string;
}

export interface GradingScheme {
  description: string; // Free text description of grading scheme
  lastModified: string;
  modifiedBy: string; // User ID - visible to admins for audit trail
}

export interface RateLimit {
  userId: string; // Primary key
  dailyCount: number; // Messages sent today
  totalCount: number; // Lifetime message count
  lastResetDate: string; // Date of last daily reset (YYYY-MM-DD)
  lastMessageTime: string; // Timestamp of last message
}

// Telegram-specific interfaces
export interface TelegramUpdate {
  message?: Message;
  callback_query?: CallbackQuery;
  update_id: number;
}

export interface Message {
  message_id: number;
  from?: TelegramUser;
  chat: Chat;
  date: number;
  text?: string;
}

export interface CallbackQuery {
  id: string;
  from: TelegramUser;
  message?: Message;
  data?: string;
}

export interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

export interface Chat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

export interface WebhookResponse {
  statusCode: number;
  body: string;
}

// State management types
export enum ConversationState {
  MAIN_MENU = 'MAIN_MENU',
  BROWSING_CATEGORIES = 'BROWSING_CATEGORIES',
  VIEWING_COURSE = 'VIEWING_COURSE',
  POSTING_REVIEW = 'POSTING_REVIEW',
  COLLECTING_USER_INFO = 'COLLECTING_USER_INFO',
  COLLECTING_NAME = 'COLLECTING_NAME',
  COLLECTING_PROMOTION = 'COLLECTING_PROMOTION',
  VIEWING_MY_REVIEWS = 'VIEWING_MY_REVIEWS',
  EDITING_REVIEW = 'EDITING_REVIEW',
  EDITING_REVIEW_TEXT = 'EDITING_REVIEW_TEXT',
  REQUESTING_COURSE_EDIT = 'REQUESTING_COURSE_EDIT',
  COLLECTING_COURSE_EDIT_TEXT = 'COLLECTING_COURSE_EDIT_TEXT'
}

// Course categories
export enum CourseCategory {
  MAA = 'MAA',
  PHY = 'PHY',
  CSE = 'CSE',
  ECO = 'ECO',
  LAB = 'LAB',
  HSS = 'HSS',
  PDV = 'PDV',
  BIO = 'BIO',
  CHE = 'CHE',
  SPOFAL = 'SPOFAL',
  PRL = 'PRL'
}