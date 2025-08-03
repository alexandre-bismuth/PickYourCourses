import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { CourseRepository } from '../database/repositories/course';
import { Course, GradingScheme } from '../models';

/**
 * Validation result for grading scheme
 */
export interface GradingSchemeValidation {
  isValid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Grading scheme modification result
 */
export interface GradingSchemeModificationResult {
  success: boolean;
  course: Course;
  validation: GradingSchemeValidation;
}

/**
 * Service for managing grading schemes with validation
 */
export class GradingSchemeService {
  private courseRepository: CourseRepository;

  constructor(documentClient: DocumentClient) {
    this.courseRepository = new CourseRepository(documentClient);
  }

  /**
   * Validate grading scheme description
   */
  validateGradingScheme(description: string): GradingSchemeValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if description is empty
    if (!description || description.trim() === '') {
      errors.push('Grading scheme description cannot be empty');
      return { isValid: false, errors, warnings };
    }

    // Check description length
    if (description.trim().length < 10) {
      warnings.push('Grading scheme description is quite short - consider adding more detail');
    }

    if (description.trim().length > 500) {
      warnings.push('Grading scheme description is very long - consider making it more concise');
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings
    };
  }

  /**
   * Get current grading scheme for a course
   */
  async getCurrentGradingScheme(courseId: string): Promise<GradingScheme | null> {
    const course = await this.courseRepository.get(courseId);
    return course ? course.gradingScheme : null;
  }

  /**
   * Update grading scheme for a course with validation
   */
  async updateGradingScheme(
    courseId: string,
    description: string,
    modifiedBy: string
  ): Promise<GradingSchemeModificationResult> {
    // Validate the new grading scheme
    const validation = this.validateGradingScheme(description);

    if (!validation.isValid) {
      return {
        success: false,
        course: null as any,
        validation
      };
    }

    // Update the course with new grading scheme
    const updatedCourse = await this.courseRepository.updateGradingScheme(courseId, description, modifiedBy);

    return {
      success: true,
      course: updatedCourse,
      validation
    };
  }

  /**
   * Delete grading scheme (sets to default description)
   */
  async deleteGradingScheme(courseId: string, deletedBy: string): Promise<GradingSchemeModificationResult> {
    // Set default grading scheme description
    const defaultDescription = "No grading information available";

    // Update the course
    const updatedCourse = await this.courseRepository.updateGradingScheme(courseId, defaultDescription, deletedBy);

    return {
      success: true,
      course: updatedCourse,
      validation: { isValid: true, errors: [], warnings: [] }
    };
  }

  /**
   * Get suggested grading scheme descriptions based on course category
   */
  getSuggestedGradingSchemes(category: string): string[] {
    const suggestions: Record<string, string[]> = {
      'MAA': [
        "Homework (20%), Midterm (30%), Final Exam (50%)",
        "Quizzes (15%), Homework (25%), Final Exam (60%)",
        "100% Final Exam with bonus points for homework"
      ],
      'PHY': [
        "Lab Reports (25%), Midterm (35%), Final Exam (40%)",
        "Lab Reports (20%), Problem Sets (20%), Final Exam (60%)",
        "Attendance (40%), Project (40%), Homework (20%)"
      ],
      'CSE': [
        "Programming Assignments (40%), Midterm (25%), Final Project (35%)",
        "Programming Assignments (30%), Midterm (30%), Final Exam (40%)",
        "100% Final Exam, no curve, bonus points possible"
      ],
      'CHE': [
        "Lab reports, participation, tests, homework; optional final to improve grade"
      ],
      'HSS': [
        "Essay on given topic",
        "Group presentation + final essay, no exam",
        "Attendance + participation + final presentation"
      ],
      'ECO': [
        "Final exam with two sections",
        "Midterm (40%), Final (60%)",
        "Problem sets (30%), Final exam (70%)"
      ]
    };

    return suggestions[category] || ["No grading information available"];
  }
}