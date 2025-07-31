/**
 * UI Components for Telegram Bot Interface
 * Provides reusable inline keyboard components and pagination utilities
 */

import {
  InlineKeyboardMarkup,
  InlineKeyboardButton,
} from "node-telegram-bot-api";
import { CourseCategory } from "../models";

/**
 * Pagination configuration
 */
export interface PaginationConfig {
  currentPage: number;
  totalPages: number;
  itemsPerPage: number;
  totalItems: number;
}

/**
 * Pagination result with items and navigation
 */
export interface PaginatedResult<T> {
  items: T[];
  pagination: PaginationConfig;
  hasNextPage: boolean;
  hasPreviousPage: boolean;
}

/**
 * Navigation button configuration
 */
export interface NavigationButton {
  text: string;
  callbackData: string;
}

/**
 * Menu item configuration
 */
export interface MenuItem {
  text: string;
  callbackData: string;
  emoji?: string;
}

/**
 * UI Components utility class for generating Telegram inline keyboards
 */
export class UIComponents {
  private static readonly ITEMS_PER_PAGE = 10;
  private static readonly MAX_BUTTONS_PER_ROW = 2;

  /**
   * Create main menu keyboard
   */
  static createMainMenu(): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: "📚 Browse Courses", callback_data: "browse_categories" },
        { text: "✍️ Post Review", callback_data: "post_review" },
      ],
      [
        { text: "⭐ My Reviews", callback_data: "my_reviews" },
        { text: "❓ Help", callback_data: "help" },
      ],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create course categories menu (page 1: MAA, PHY, CSE, ECO, LAB)
   */
  static createCategoriesMenuPage1(): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: "🔢 MAA - Mathematics", callback_data: "category_MAA" },
        { text: "⚛️ PHY - Physics", callback_data: "category_PHY" },
      ],
      [
        { text: "💻 CSE - Computer Science", callback_data: "category_CSE" },
        { text: "💰 ECO - Economics", callback_data: "category_ECO" },
      ],
      [{ text: "🔬 LAB - Laboratory", callback_data: "category_LAB" }],
      [{ text: "➡️ Next Page", callback_data: "categories_page_2" }],
      [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create course categories menu (page 2: HSS, PDV, BIO, CHEM, SPOFAL, PRL)
   */
  static createCategoriesMenuPage2(): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        {
          text: "📖 HSS - Humanities & Social Sciences",
          callback_data: "category_HSS",
        },
      ],
      [
        {
          text: "🎯 PDV - Personal Development",
          callback_data: "category_PDV",
        },
        { text: "🧬 BIO - Biology", callback_data: "category_BIO" },
      ],
      [
        { text: "⚗️ CHEM - Chemistry", callback_data: "category_CHEM" },
        { text: "🏃 SPOFAL - Sports", callback_data: "category_SPOFAL" },
      ],
      [{ text: "🌍 PRL - Languages", callback_data: "category_PRL" }],
      [{ text: "⬅️ Previous Page", callback_data: "categories_page_1" }],
      [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create admin menu keyboard
   */
  static createAdminMenu(): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: "🗑️ Manage Reviews", callback_data: "admin_manage_reviews" },
        { text: "👥 User Activity", callback_data: "admin_user_activity" },
      ],
      [
        { text: "📊 System Stats", callback_data: "admin_system_stats" },
        { text: "📋 Audit Logs", callback_data: "admin_audit_logs" },
      ],
      [{ text: "🏠 Main Menu", callback_data: "main_menu" }],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create course list with pagination
   */
  static createCourseList(
    courses: Array<{ courseId: string; name: string; averageRating?: number }>,
    category: string,
    currentPage: number = 1
  ): { keyboard: InlineKeyboardMarkup; pagination: PaginationConfig } {
    const itemsPerPage = this.ITEMS_PER_PAGE;
    const totalItems = courses.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const pageItems = courses.slice(startIndex, endIndex);

    const keyboard: InlineKeyboardButton[][] = [];

    // Add course buttons (2 per row)
    for (let i = 0; i < pageItems.length; i += this.MAX_BUTTONS_PER_ROW) {
      const row: InlineKeyboardButton[] = [];
      for (
        let j = i;
        j < Math.min(i + this.MAX_BUTTONS_PER_ROW, pageItems.length);
        j++
      ) {
        const course = pageItems[j];
        if (course) {
          const ratingText = course.averageRating
            ? ` (⭐${course.averageRating.toFixed(1)})`
            : "";
          row.push({
            text: `${course.courseId}${ratingText}`,
            callback_data: `course_${course.courseId}`,
          });
        }
      }
      keyboard.push(row);
    }

    // Add pagination controls
    if (totalPages > 1) {
      const paginationRow: InlineKeyboardButton[] = [];

      if (currentPage > 1) {
        paginationRow.push({
          text: "⬅️ Previous",
          callback_data: `courses_${category}_page_${currentPage - 1}`,
        });
      }

      paginationRow.push({
        text: `${currentPage}/${totalPages}`,
        callback_data: "noop",
      });

      if (currentPage < totalPages) {
        paginationRow.push({
          text: "Next ➡️",
          callback_data: `courses_${category}_page_${currentPage + 1}`,
        });
      }

      keyboard.push(paginationRow);
    }

    // Add navigation buttons
    keyboard.push([
      { text: "🔙 Back to Categories", callback_data: "browse_categories" },
      { text: "🏠 Main Menu", callback_data: "main_menu" },
    ]);

    const pagination: PaginationConfig = {
      currentPage,
      totalPages,
      itemsPerPage,
      totalItems,
    };

    return {
      keyboard: { inline_keyboard: keyboard },
      pagination,
    };
  }

  /**
   * Create review list with pagination and voting buttons
   */
  static createReviewList(
    reviews: Array<{
      reviewId: string;
      text?: string;
      ratings: { overall: number; quality: number; difficulty: number };
      upvotes: number;
      downvotes: number;
      anonymous: boolean;
      userVote?: "up" | "down" | null;
    }>,
    courseId: string,
    currentPage: number = 1
  ): { keyboard: InlineKeyboardMarkup; pagination: PaginationConfig } {
    const itemsPerPage = 5; // Fewer items per page for reviews since they're longer
    const totalItems = reviews.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const pageItems = reviews.slice(startIndex, endIndex);

    const keyboard: InlineKeyboardButton[][] = [];

    // Add review voting buttons
    pageItems.forEach((review, index) => {
      const reviewNumber = startIndex + index + 1;
      const upvoteText = review.userVote === "up" ? "👍✅" : "👍";
      const downvoteText = review.userVote === "down" ? "👎✅" : "👎";

      keyboard.push([
        {
          text: `Review #${reviewNumber}: ${upvoteText} ${review.upvotes}`,
          callback_data: `vote_${review.reviewId}_up`,
        },
        {
          text: `${downvoteText} ${review.downvotes}`,
          callback_data: `vote_${review.reviewId}_down`,
        },
      ]);
    });

    // Add pagination controls
    if (totalPages > 1) {
      const paginationRow: InlineKeyboardButton[] = [];

      if (currentPage > 1) {
        paginationRow.push({
          text: "⬅️ Previous",
          callback_data: `reviews_${courseId}_page_${currentPage - 1}`,
        });
      }

      paginationRow.push({
        text: `${currentPage}/${totalPages}`,
        callback_data: "noop",
      });

      if (currentPage < totalPages) {
        paginationRow.push({
          text: "Next ➡️",
          callback_data: `reviews_${courseId}_page_${currentPage + 1}`,
        });
      }

      keyboard.push(paginationRow);
    }

    // Add navigation buttons
    keyboard.push([
      { text: "🔙 Back to Course", callback_data: `course_${courseId}` },
      { text: "🏠 Main Menu", callback_data: "main_menu" },
    ]);

    const pagination: PaginationConfig = {
      currentPage,
      totalPages,
      itemsPerPage,
      totalItems,
    };

    return {
      keyboard: { inline_keyboard: keyboard },
      pagination,
    };
  }

  /**
   * Create course details keyboard with action buttons
   */
  static createCourseDetailsMenu(courseId: string): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: "📖 View Reviews", callback_data: `reviews_${courseId}` },
        { text: "✍️ Write Review", callback_data: `write_review_${courseId}` },
      ],
      [
        { text: "🔙 Back to Category", callback_data: "back_to_category" },
        { text: "🏠 Main Menu", callback_data: "main_menu" },
      ],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create review management keyboard for individual review actions
   */
  static createReviewManagementMenu(reviewId: string): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: "✏️ Edit Review", callback_data: `edit_review_${reviewId}` },
        {
          text: "🗑️ Delete Review",
          callback_data: `delete_review_${reviewId}`,
        },
      ],
      [
        {
          text: "📊 View Course",
          callback_data: `view_course_from_review_${reviewId}`,
        },
      ],
      [
        { text: "🔙 Back to My Reviews", callback_data: "my_reviews" },
        { text: "🏠 Main Menu", callback_data: "main_menu" },
      ],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create rating selection keyboard (1-5 stars)
   */
  static createRatingKeyboard(
    ratingType: "overall" | "quality" | "difficulty"
  ): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: "⭐", callback_data: `rating_${ratingType}_1` },
        { text: "⭐⭐", callback_data: `rating_${ratingType}_2` },
        { text: "⭐⭐⭐", callback_data: `rating_${ratingType}_3` },
      ],
      [
        { text: "⭐⭐⭐⭐", callback_data: `rating_${ratingType}_4` },
        { text: "⭐⭐⭐⭐⭐", callback_data: `rating_${ratingType}_5` },
      ],
      [
        { text: "🔙 Back", callback_data: "back_to_review_form" },
        { text: "❌ Cancel", callback_data: "cancel_review" },
      ],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create confirmation keyboard (Yes/No)
   */
  static createConfirmationKeyboard(
    confirmAction: string,
    cancelAction: string = "cancel",
    confirmText: string = "✅ Yes",
    cancelText: string = "❌ No"
  ): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: confirmText, callback_data: confirmAction },
        { text: cancelText, callback_data: cancelAction },
      ],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create back and main menu navigation
   */
  static createBackNavigation(backAction: string): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [
      [
        { text: "🔙 Back", callback_data: backAction },
        { text: "🏠 Main Menu", callback_data: "main_menu" },
      ],
    ];

    return { inline_keyboard: keyboard };
  }

  /**
   * Create generic menu from menu items
   */
  static createGenericMenu(
    items: MenuItem[],
    navigationButtons?: NavigationButton[]
  ): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [];

    // Add menu items (2 per row)
    for (let i = 0; i < items.length; i += this.MAX_BUTTONS_PER_ROW) {
      const row: InlineKeyboardButton[] = [];
      for (
        let j = i;
        j < Math.min(i + this.MAX_BUTTONS_PER_ROW, items.length);
        j++
      ) {
        const item = items[j];
        if (item) {
          const text = item.emoji ? `${item.emoji} ${item.text}` : item.text;
          row.push({
            text,
            callback_data: item.callbackData,
          });
        }
      }
      keyboard.push(row);
    }

    // Add navigation buttons
    if (navigationButtons && navigationButtons.length > 0) {
      const navRow: InlineKeyboardButton[] = navigationButtons.map((nav) => ({
        text: nav.text,
        callback_data: nav.callbackData,
      }));
      keyboard.push(navRow);
    }

    return { inline_keyboard: keyboard };
  }

  /**
   * Paginate an array of items
   */
  static paginate<T>(
    items: T[],
    page: number = 1,
    itemsPerPage: number = this.ITEMS_PER_PAGE
  ): PaginatedResult<T> {
    const totalItems = items.length;
    const totalPages = Math.ceil(totalItems / itemsPerPage);
    const currentPage = Math.max(1, Math.min(page, totalPages));
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalItems);
    const pageItems = items.slice(startIndex, endIndex);

    return {
      items: pageItems,
      pagination: {
        currentPage,
        totalPages,
        itemsPerPage,
        totalItems,
      },
      hasNextPage: currentPage < totalPages,
      hasPreviousPage: currentPage > 1,
    };
  }

  /**
   * Get category emoji
   */
  static getCategoryEmoji(category: CourseCategory | string): string {
    const emojiMap: Record<string, string> = {
      [CourseCategory.MAA]: "🔢",
      [CourseCategory.PHY]: "⚛️",
      [CourseCategory.CSE]: "💻",
      [CourseCategory.ECO]: "💰",
      [CourseCategory.LAB]: "🔬",
      [CourseCategory.HSS]: "📖",
      [CourseCategory.PDV]: "🎯",
      [CourseCategory.BIO]: "🧬",
      [CourseCategory.CHEM]: "⚗️",
      [CourseCategory.SPOFAL]: "🏃",
      [CourseCategory.PRL]: "🌍",
    };

    return emojiMap[category] || "📚";
  }

  /**
   * Format star rating display
   */
  static formatStarRating(rating: number): string {
    const fullStars = Math.floor(rating);
    const hasHalfStar = rating % 1 >= 0.5;
    const emptyStars = 5 - fullStars - (hasHalfStar ? 1 : 0);

    return (
      "⭐".repeat(fullStars) +
      (hasHalfStar ? "⭐" : "") +
      "☆".repeat(emptyStars) +
      ` (${rating.toFixed(1)})`
    );
  }

  /**
   * Create error message keyboard with retry option
   */
  static createErrorKeyboard(retryAction?: string): InlineKeyboardMarkup {
    const keyboard: InlineKeyboardButton[][] = [];

    if (retryAction) {
      keyboard.push([{ text: "🔄 Try Again", callback_data: retryAction }]);
    }

    keyboard.push([{ text: "🏠 Main Menu", callback_data: "main_menu" }]);

    return { inline_keyboard: keyboard };
  }
}
