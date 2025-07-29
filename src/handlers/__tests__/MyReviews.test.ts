import { WebhookHandler } from "../WebhookHandler";
import { RateLimitService } from "../../services/RateLimitService";
import { StateManager } from "../../services/StateManager";
import { ReviewService } from "../../services/ReviewService";
import { CourseService, CourseDetails } from "../../services/CourseService";
import { ConversationState, CourseCategory } from "../../models";
import TelegramBot from "node-telegram-bot-api";

// Mock the dependencies
jest.mock("node-telegram-bot-api");
jest.mock("../../services/RateLimitService");
jest.mock("../../services/StateManager");
jest.mock("../../services/ReviewService");
jest.mock("../../services/CourseService");

describe("My Reviews Functionality", () => {
  let webhookHandler: WebhookHandler;
  let mockBot: jest.Mocked<TelegramBot>;
  let mockRateLimitService: jest.Mocked<RateLimitService>;
  let mockStateManager: jest.Mocked<StateManager>;
  let mockReviewService: jest.Mocked<ReviewService>;
  let mockCourseService: jest.Mocked<CourseService>;

  const testUserId = "123456789";
  const testChatId = 987654321;

  beforeEach(() => {
    // Create mocked instances
    mockBot = new TelegramBot("fake-token") as jest.Mocked<TelegramBot>;
    mockRateLimitService = new RateLimitService(
      {} as any
    ) as jest.Mocked<RateLimitService>;
    mockStateManager = new StateManager() as jest.Mocked<StateManager>;
    mockReviewService = new ReviewService(
      {} as any
    ) as jest.Mocked<ReviewService>;
    mockCourseService = new CourseService(
      {} as any
    ) as jest.Mocked<CourseService>;

    // Mock the methods
    mockBot.editMessageText = jest.fn().mockResolvedValue({});
    mockBot.sendMessage = jest.fn().mockResolvedValue({});
    mockStateManager.setState = jest.fn().mockResolvedValue(undefined);
    mockStateManager.getState = jest.fn().mockResolvedValue({
      state: ConversationState.MAIN_MENU,
      data: {},
    });

    webhookHandler = new WebhookHandler(
      "fake-token",
      mockRateLimitService,
      mockStateManager,
      mockReviewService,
      mockCourseService,
      mockBot
    );
  });

  describe("handleMyReviewsCallback", () => {
    it("should show empty state when user has no reviews", async () => {
      // Mock empty reviews
      mockReviewService.getUserReviews.mockResolvedValue([]);

      // Call the handler
      await webhookHandler["handleMyReviewsCallback"](
        testUserId,
        testChatId,
        "my_reviews",
        123
      );

      // Verify state was set
      expect(mockStateManager.setState).toHaveBeenCalledWith(
        testUserId,
        ConversationState.VIEWING_MY_REVIEWS
      );

      // Verify message was sent
      expect(mockBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining("You haven't written any course reviews yet"),
        expect.objectContaining({
          chat_id: testChatId,
          message_id: 123,
          parse_mode: "MarkdownV2",
        })
      );
    });

    it("should display user reviews when they exist", async () => {
      // Mock user reviews
      const mockReviews = [
        {
          reviewId: "review1",
          courseId: "MAA101",
          userId: testUserId,
          ratings: { overall: 4, quality: 4, difficulty: 3 },
          text: "Great course!",
          anonymous: false,
          createdAt: "2024-01-15T10:00:00Z",
          updatedAt: "2024-01-15T10:00:00Z",
          isDeleted: false,
          upvotes: 5,
          downvotes: 1,
        },
      ];

      const mockCourseDetails: CourseDetails = {
        courseId: "MAA101",
        name: "Analysis I",
        category: CourseCategory.MAA,
        description: "Mathematical Analysis course",
        gradingScheme: {
          components: [
            { name: "Final Exam", percentage: 60 },
            { name: "Midterm", percentage: 40 },
          ],
          lastModified: "2024-01-01T00:00:00Z",
          modifiedBy: "admin",
        },
        averageRatings: { overall: 4.2, quality: 4.1, difficulty: 3.8 },
        reviewCount: 10,
        totalVotes: 25,
      };

      mockReviewService.getUserReviews.mockResolvedValue(mockReviews);
      mockCourseService.getCourseDetails.mockResolvedValue(mockCourseDetails);

      // Call the handler
      await webhookHandler["handleMyReviewsCallback"](
        testUserId,
        testChatId,
        "my_reviews",
        123
      );

      // Verify reviews were fetched
      expect(mockReviewService.getUserReviews).toHaveBeenCalledWith(testUserId);
      expect(mockCourseService.getCourseDetails).toHaveBeenCalledWith("MAA101");

      // Verify message contains review information
      expect(mockBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining("My Reviews"),
        expect.objectContaining({
          chat_id: testChatId,
          message_id: 123,
          parse_mode: "MarkdownV2",
        })
      );
    });

    it("should handle pagination correctly", async () => {
      // Mock multiple reviews to test pagination
      const mockReviews = Array.from({ length: 7 }, (_, i) => ({
        reviewId: `review${i + 1}`,
        courseId: `MAA10${i + 1}`,
        userId: testUserId,
        ratings: { overall: 4, quality: 4, difficulty: 3 },
        text: `Review ${i + 1}`,
        anonymous: false,
        createdAt: `2024-01-${15 + i}T10:00:00Z`,
        updatedAt: `2024-01-${15 + i}T10:00:00Z`,
        isDeleted: false,
        upvotes: 5,
        downvotes: 1,
      }));

      mockReviewService.getUserReviews.mockResolvedValue(mockReviews);
      mockCourseService.getCourseDetails.mockResolvedValue({
        courseId: "MAA101",
        name: "Analysis I",
        category: CourseCategory.MAA,
        description: "Mathematical Analysis course",
        gradingScheme: {
          components: [
            { name: "Final Exam", percentage: 60 },
            { name: "Midterm", percentage: 40 },
          ],
          lastModified: "2024-01-01T00:00:00Z",
          modifiedBy: "admin",
        },
        averageRatings: { overall: 4.2, quality: 4.1, difficulty: 3.8 },
        reviewCount: 10,
        totalVotes: 25,
      });

      // Call the handler for page 2
      await webhookHandler["handleMyReviewsCallback"](
        testUserId,
        testChatId,
        "my_reviews_page_2",
        123
      );

      // Verify pagination controls are included
      const call = mockBot.editMessageText.mock.calls[0];
      const keyboard = call?.[1]?.reply_markup;

      // Should have pagination buttons
      expect(keyboard?.inline_keyboard).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({
              text: expect.stringContaining("Previous"),
            }),
          ]),
        ])
      );
    });
  });

  describe("handleManageReviewCallback", () => {
    it("should display review details for management", async () => {
      const mockReview = {
        reviewId: "review1",
        courseId: "MAA101",
        userId: testUserId,
        ratings: { overall: 4, quality: 4, difficulty: 3 },
        text: "Great course!",
        anonymous: false,
        createdAt: "2024-01-15T10:00:00Z",
        updatedAt: "2024-01-15T10:00:00Z",
        isDeleted: false,
        upvotes: 5,
        downvotes: 1,
      };

      const mockCourseDetails: CourseDetails = {
        courseId: "MAA101",
        name: "Analysis I",
        category: CourseCategory.MAA,
        description: "Mathematical Analysis course",
        gradingScheme: {
          components: [
            { name: "Final Exam", percentage: 60 },
            { name: "Midterm", percentage: 40 },
          ],
          lastModified: "2024-01-01T00:00:00Z",
          modifiedBy: "admin",
        },
        averageRatings: { overall: 4.2, quality: 4.1, difficulty: 3.8 },
        reviewCount: 10,
        totalVotes: 25,
      };

      mockReviewService.getUserReviews.mockResolvedValue([mockReview]);
      mockCourseService.getCourseDetails.mockResolvedValue(mockCourseDetails);

      // Call the handler
      await webhookHandler["handleManageReviewCallback"](
        testUserId,
        testChatId,
        "manage_review_review1",
        123
      );

      // Verify review details are displayed
      expect(mockBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining("Review Management"),
        expect.objectContaining({
          chat_id: testChatId,
          message_id: 123,
          parse_mode: "MarkdownV2",
        })
      );

      // Verify management buttons are included
      const call = mockBot.editMessageText.mock.calls[0];
      const keyboard = call?.[1]?.reply_markup;

      expect(keyboard?.inline_keyboard).toEqual(
        expect.arrayContaining([
          expect.arrayContaining([
            expect.objectContaining({ text: "✏️ Edit Review" }),
            expect.objectContaining({ text: "🗑️ Delete Review" }),
          ]),
        ])
      );
    });
  });

  describe("handleConfirmDeleteReviewCallback", () => {
    it("should delete review successfully", async () => {
      mockReviewService.deleteReview.mockResolvedValue();

      // Call the handler
      await webhookHandler["handleConfirmDeleteReviewCallback"](
        testUserId,
        testChatId,
        "confirm_delete_review_review1",
        123
      );

      // Verify review was deleted
      expect(mockReviewService.deleteReview).toHaveBeenCalledWith(
        "review1",
        testUserId
      );

      // Verify success message
      expect(mockBot.editMessageText).toHaveBeenCalledWith(
        expect.stringContaining("Review Deleted Successfully"),
        expect.objectContaining({
          chat_id: testChatId,
          message_id: 123,
          parse_mode: "MarkdownV2",
        })
      );
    });

    it("should handle deletion errors gracefully", async () => {
      mockReviewService.deleteReview.mockRejectedValue(
        new Error("Review not found")
      );

      // Call the handler
      await webhookHandler["handleConfirmDeleteReviewCallback"](
        testUserId,
        testChatId,
        "confirm_delete_review_review1",
        123
      );

      // Verify error message was sent
      expect(mockBot.sendMessage).toHaveBeenCalledWith(
        testChatId,
        expect.stringContaining("Review not found or already deleted")
      );
    });
  });
});
