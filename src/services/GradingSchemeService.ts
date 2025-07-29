import { DocumentClient } from 'aws-sdk/clients/dynamodb';
import { CourseRepository } from '../database/repositories/course';
import { GradingHistoryRepository, GradingComponent, GradingSchemeHistory } from '../database/repositories/gradingHistory';
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
  historyEntry: GradingSchemeHistory;
  validation: GradingSchemeValidation;
}

/**
 * Service for managing grading schemes with validation and history tracking
 */
export class GradingSchemeService {
  private courseRepository: CourseRepository;
  private gradingHistoryRepository: GradingHistoryRepository;

  constructor(documentClient: DocumentClient) {
    this.courseRepository = new CourseRepository(documentClient);
    this.gradingHistoryRepository = new GradingHistoryRepository(documentClient);
  }

  /**
   * Validate grading scheme components
   */
  validateGradingScheme(components: GradingComponent[]): GradingSchemeValidation {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check if components array is empty
    if (!components || components.length === 0) {
      errors.push('Grading scheme must have at least one component');
      return { isValid: false, errors, warnings };
    }

    // Validate each component
    components.forEach((component, index) => {
      if (!component.name || component.name.trim() === '') {
        errors.push(`Component ${index + 1}: Name is required`);
      }

      if (typeof component.percentage !== 'number') {
        errors.push(`Component ${index + 1}: Percentage must be a number`);
      } else {
        if (component.percentage <= 0) {
          errors.push(`Component ${index + 1}: Percentage must be greater than 0`);
        }
        if (component.percentage > 100) {
          errors.push(`Component ${index + 1}: Percentage cannot exceed 100`);
        }
      }
    });

    // Check for duplicate component names
    const componentNames = components.map(c => c.name.trim().toLowerCase());
    const duplicateNames = componentNames.filter((name, index) => componentNames.indexOf(name) !== index);
    if (duplicateNames.length > 0) {
      errors.push(`Duplicate component names found: ${[...new Set(duplicateNames)].join(', ')}`);
    }

    // Check if percentages sum to 100
    const totalPercentage = components.reduce((sum, component) => sum + component.percentage, 0);
    const tolerance = 0.01; // Allow small floating point errors

    if (Math.abs(totalPercentage - 100) > tolerance) {
      errors.push(`Total percentage must equal 100% (current: ${totalPercentage.toFixed(2)}%)`);
    }

    // Warnings for best practices
    if (components.length > 10) {
      warnings.push('Consider consolidating grading components - more than 10 components may be confusing');
    }

    components.forEach(component => {
      if (component.percentage < 5) {
        warnings.push(`Component "${component.name}" has very low weight (${component.percentage}%) - consider if it's necessary`);
      }
    });

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
   * Update grading scheme for a course with validation and history tracking
   */
  async updateGradingScheme(
    courseId: string,
    components: GradingComponent[],
    modifiedBy: string
  ): Promise<GradingSchemeModificationResult> {
    // Validate the new grading scheme
    const validation = this.validateGradingScheme(components);

    if (!validation.isValid) {
      return {
        success: false,
        course: null as any,
        historyEntry: null as any,
        validation
      };
    }

    // Get current grading scheme for history tracking
    const currentCourse = await this.courseRepository.get(courseId);
    const previousComponents = currentCourse?.gradingScheme.components;

    // Update the course with new grading scheme
    const updatedCourse = await this.courseRepository.updateGradingScheme(courseId, components, modifiedBy);

    // Create history entry
    const historyEntry = await this.gradingHistoryRepository.createHistoryEntry(
      courseId,
      components,
      modifiedBy,
      currentCourse ? 'UPDATE' : 'CREATE',
      previousComponents
    );

    return {
      success: true,
      course: updatedCourse,
      historyEntry,
      validation
    };
  }

  /**
   * Get grading scheme history for a course
   */
  async getGradingSchemeHistory(courseId: string): Promise<GradingSchemeHistory[]> {
    return this.gradingHistoryRepository.getHistoryByCourse(courseId);
  }

  /**
   * Get recent grading scheme modifications across all courses
   */
  async getRecentModifications(limit: number = 50): Promise<GradingSchemeHistory[]> {
    return this.gradingHistoryRepository.getRecentModifications(limit);
  }

  /**
   * Get modifications by a specific user
   */
  async getModificationsByUser(userId: string): Promise<GradingSchemeHistory[]> {
    return this.gradingHistoryRepository.getModificationsByUser(userId);
  }

  /**
   * Get modification statistics
   */
  async getModificationStats(): Promise<{
    totalModifications: number;
    modificationsByAction: Record<string, number>;
    topModifiers: Array<{ userId: string; count: number }>;
  }> {
    return this.gradingHistoryRepository.getModificationStats();
  }

  /**
   * Delete grading scheme (sets to default 100% final exam)
   */
  async deleteGradingScheme(courseId: string, deletedBy: string): Promise<GradingSchemeModificationResult> {
    // Get current grading scheme for history
    const currentCourse = await this.courseRepository.get(courseId);
    const previousComponents = currentCourse?.gradingScheme.components;

    // Set default grading scheme (100% final exam)
    const defaultComponents: GradingComponent[] = [
      { name: 'Final Exam', percentage: 100 }
    ];

    // Update the course
    const updatedCourse = await this.courseRepository.updateGradingScheme(courseId, defaultComponents, deletedBy);

    // Create history entry for deletion
    const historyEntry = await this.gradingHistoryRepository.createHistoryEntry(
      courseId,
      defaultComponents,
      deletedBy,
      'DELETE',
      previousComponents
    );

    return {
      success: true,
      course: updatedCourse,
      historyEntry,
      validation: { isValid: true, errors: [], warnings: [] }
    };
  }

  /**
   * Restore grading scheme from history
   */
  async restoreGradingScheme(
    courseId: string,
    historyId: string,
    restoredBy: string
  ): Promise<GradingSchemeModificationResult> {
    // Get the history entry to restore
    const historyEntry = await this.gradingHistoryRepository.get(historyId);

    if (!historyEntry || historyEntry.courseId !== courseId) {
      throw new Error('History entry not found or does not belong to the specified course');
    }

    // Restore the grading scheme
    return this.updateGradingScheme(courseId, historyEntry.components, restoredBy);
  }

  /**
   * Compare two grading schemes
   */
  compareGradingSchemes(
    scheme1: GradingComponent[],
    scheme2: GradingComponent[]
  ): {
    added: GradingComponent[];
    removed: GradingComponent[];
    modified: Array<{
      name: string;
      oldPercentage: number;
      newPercentage: number;
    }>;
    unchanged: GradingComponent[];
  } {
    const added: GradingComponent[] = [];
    const removed: GradingComponent[] = [];
    const modified: Array<{ name: string; oldPercentage: number; newPercentage: number }> = [];
    const unchanged: GradingComponent[] = [];

    // Create maps for easier comparison
    const scheme1Map = new Map(scheme1.map(c => [c.name.toLowerCase(), c]));
    const scheme2Map = new Map(scheme2.map(c => [c.name.toLowerCase(), c]));

    // Find added and modified components
    scheme2.forEach(component => {
      const key = component.name.toLowerCase();
      const oldComponent = scheme1Map.get(key);

      if (!oldComponent) {
        added.push(component);
      } else if (oldComponent.percentage !== component.percentage) {
        modified.push({
          name: component.name,
          oldPercentage: oldComponent.percentage,
          newPercentage: component.percentage
        });
      } else {
        unchanged.push(component);
      }
    });

    // Find removed components
    scheme1.forEach(component => {
      const key = component.name.toLowerCase();
      if (!scheme2Map.has(key)) {
        removed.push(component);
      }
    });

    return { added, removed, modified, unchanged };
  }

  /**
   * Get suggested grading schemes based on course category
   */
  getSuggestedGradingSchemes(category: string): GradingComponent[][] {
    const suggestions: Record<string, GradingComponent[][]> = {
      'MAA': [
        [
          { name: 'Homework', percentage: 20 },
          { name: 'Midterm', percentage: 30 },
          { name: 'Final Exam', percentage: 50 }
        ],
        [
          { name: 'Quizzes', percentage: 15 },
          { name: 'Homework', percentage: 25 },
          { name: 'Final Exam', percentage: 60 }
        ]
      ],
      'PHY': [
        [
          { name: 'Lab Reports', percentage: 25 },
          { name: 'Midterm', percentage: 35 },
          { name: 'Final Exam', percentage: 40 }
        ],
        [
          { name: 'Lab Reports', percentage: 20 },
          { name: 'Problem Sets', percentage: 20 },
          { name: 'Final Exam', percentage: 60 }
        ]
      ],
      'CSE': [
        [
          { name: 'Programming Assignments', percentage: 40 },
          { name: 'Midterm', percentage: 25 },
          { name: 'Final Project', percentage: 35 }
        ],
        [
          { name: 'Programming Assignments', percentage: 30 },
          { name: 'Midterm', percentage: 30 },
          { name: 'Final Exam', percentage: 40 }
        ]
      ]
    };

    return suggestions[category] || [
      [{ name: 'Final Exam', percentage: 100 }]
    ];
  }
}