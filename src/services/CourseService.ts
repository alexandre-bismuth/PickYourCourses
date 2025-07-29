import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { CourseRepository } from '../database/repositories/course';
import { Course, CourseCategory, GradingScheme } from '../models';

/**
 * Course category page configuration
 */
export interface CategoryPage {
  pageNumber: number;
  categories: CourseCategory[];
}

/**
 * Course details with calculated ratings
 */
export interface CourseDetails extends Course {
  totalVotes: number;
  lastReviewDate?: string;
}

/**
 * Category summary with course count
 */
export interface CategorySummary {
  category: CourseCategory;
  courseCount: number;
  averageRating: number;
}

/**
 * Service for managing courses and categories
 */
export class CourseService {
  private courseRepository: CourseRepository;

  // Two-page category system as specified in requirements
  public static readonly CATEGORY_PAGES: CategoryPage[] = [
    {
      pageNumber: 1,
      categories: [CourseCategory.MAA, CourseCategory.PHY, CourseCategory.CSE, CourseCategory.ECO, CourseCategory.LAB]
    },
    {
      pageNumber: 2,
      categories: [CourseCategory.HSS, CourseCategory.PDV, CourseCategory.BIO, CourseCategory.CHEM, CourseCategory.SPOFAL, CourseCategory.PRL]
    }
  ];

  constructor(documentClient: DocumentClient) {
    this.courseRepository = new CourseRepository(documentClient);
  }

  /**
   * Get all category pages for navigation
   */
  getCategoryPages(): CategoryPage[] {
    return CourseService.CATEGORY_PAGES;
  }

  /**
   * Get categories for a specific page
   */
  getCategoriesForPage(pageNumber: number): CourseCategory[] {
    const page = CourseService.CATEGORY_PAGES.find(p => p.pageNumber === pageNumber);
    return page ? page.categories : [];
  }

  /**
   * Get page number for a specific category
   */
  getPageForCategory(category: CourseCategory): number {
    for (const page of CourseService.CATEGORY_PAGES) {
      if (page.categories.includes(category)) {
        return page.pageNumber;
      }
    }
    return 1; // Default to page 1 if not found
  }

  /**
   * Get courses by category
   */
  async getCoursesByCategory(category: CourseCategory): Promise<Course[]> {
    return this.courseRepository.getCoursesByCategory(category);
  }

  /**
   * Get course details with enhanced information
   */
  async getCourseDetails(courseId: string): Promise<CourseDetails | null> {
    const course = await this.courseRepository.get(courseId);
    if (!course) {
      return null;
    }

    // Calculate total votes (this would typically come from review aggregation)
    const totalVotes = course.reviewCount; // Simplified for now

    const result: CourseDetails = {
      ...course,
      totalVotes
    };

    if (course.reviewCount > 0) {
      result.lastReviewDate = new Date().toISOString(); // Simplified
    }

    return result;
  }

  /**
   * Get category summaries with course counts and average ratings
   */
  async getCategorySummaries(): Promise<CategorySummary[]> {
    const categoryCounts = await this.courseRepository.getCategoriesWithCounts();
    const summaries: CategorySummary[] = [];

    for (const categoryCount of categoryCounts) {
      const category = categoryCount.category as CourseCategory;
      if (Object.values(CourseCategory).includes(category)) {
        const courses = await this.getCoursesByCategory(category);
        const averageRating = this.calculateCategoryAverageRating(courses);

        summaries.push({
          category,
          courseCount: categoryCount.count,
          averageRating
        });
      }
    }

    return summaries;
  }

  /**
   * Search courses across all categories
   */
  async searchCourses(searchTerm: string): Promise<Course[]> {
    return this.courseRepository.searchCourses(searchTerm);
  }

  /**
   * Get top-rated courses across all categories
   */
  async getTopRatedCourses(limit: number = 10): Promise<Course[]> {
    return this.courseRepository.getTopRatedCourses(limit);
  }

  /**
   * Get most reviewed courses across all categories
   */
  async getMostReviewedCourses(limit: number = 10): Promise<Course[]> {
    return this.courseRepository.getMostReviewedCourses(limit);
  }

  /**
   * Update course average ratings (typically called after new review)
   */
  async updateCourseRatings(courseId: string, newRatings: { overall: number; quality: number; difficulty: number }, reviewCount: number): Promise<Course> {
    return this.courseRepository.updateAverageRatings(courseId, newRatings, reviewCount);
  }

  /**
   * Update grading scheme for a course
   */
  async updateGradingScheme(courseId: string, components: Array<{ name: string; percentage: number }>, modifiedBy: string): Promise<Course> {
    return this.courseRepository.updateGradingScheme(courseId, components, modifiedBy);
  }

  /**
   * Get grading scheme history for a course
   */
  async getGradingHistory(courseId: string): Promise<GradingScheme[]> {
    return this.courseRepository.getGradingHistory(courseId);
  }

  /**
   * Create a new course
   */
  async createCourse(courseData: Omit<Course, 'averageRatings' | 'reviewCount'>): Promise<Course> {
    const course: Course = {
      ...courseData,
      averageRatings: {
        overall: 0,
        quality: 0,
        difficulty: 0
      },
      reviewCount: 0
    };

    return this.courseRepository.create(course);
  }

  /**
   * Check if a category is valid
   */
  isValidCategory(category: string): category is CourseCategory {
    return Object.values(CourseCategory).includes(category as CourseCategory);
  }

  /**
   * Get all valid categories
   */
  getAllCategories(): CourseCategory[] {
    return Object.values(CourseCategory);
  }

  /**
   * Calculate average rating for a category
   */
  private calculateCategoryAverageRating(courses: Course[]): number {
    if (courses.length === 0) {
      return 0;
    }

    const totalRating = courses.reduce((sum, course) => {
      return sum + (course.averageRatings.overall * course.reviewCount);
    }, 0);

    const totalReviews = courses.reduce((sum, course) => sum + course.reviewCount, 0);

    return totalReviews > 0 ? totalRating / totalReviews : 0;
  }
}