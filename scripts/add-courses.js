const AWS = require("aws-sdk");

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";
const COURSES_TABLE = `pickyourcourses-${STAGE}-courses`;

/**
 * Add courses to the database
 * @param {Array} coursesData - Array of course objects with structure:
 * {
 *   courseId: string,
 *   category: string,
 *   name: string,
 *   description?: string,
 *   gradingScheme?: { description: string, lastModified: string, modifiedBy: string }
 * }
 * @param {Object} options - Additional options
 */
async function addCourses(coursesData, options = {}) {
  console.log(`Adding ${coursesData.length} courses to ${COURSES_TABLE}...`);

  let addedCount = 0;
  let skippedCount = 0;
  let updatedCount = 0;

  for (const courseData of coursesData) {
    try {
      // Validate course data
      if (!courseData.courseId || !courseData.category || !courseData.name) {
        console.error(`✗ Invalid course data:`, courseData);
        skippedCount++;
        continue;
      }

      // Default grading scheme if not provided
      const defaultGradingScheme = {
        description: "No grading information available",
        lastModified: new Date().toISOString(),
        modifiedBy: "system"
      };

      // Check if course already exists
      let existingCourse = null;
      try {
        const result = await dynamodb.get({
          TableName: COURSES_TABLE,
          Key: { courseId: courseData.courseId }
        }).promise();
        existingCourse = result.Item;
      } catch (error) {
        // Course doesn't exist, which is fine
      }

      const courseItem = {
        courseId: courseData.courseId,
        category: courseData.category,
        name: courseData.name,
        description: courseData.description || "",
        gradingScheme: courseData.gradingScheme || defaultGradingScheme,
        averageRatings: existingCourse?.averageRatings || {
          overall: 0,
          quality: 0,
          difficulty: 0,
        },
        reviewCount: existingCourse?.reviewCount || 0,
      };

      if (existingCourse && !options.overwrite) {
        console.log(`⚠ Course ${courseData.courseId} already exists, skipping (use overwrite option to update)`);
        skippedCount++;
        continue;
      }

      await dynamodb
        .put({
          TableName: COURSES_TABLE,
          Item: courseItem,
        })
        .promise();

      if (existingCourse) {
        console.log(`✓ Updated course: ${courseData.courseId} - ${courseData.name}`);
        updatedCount++;
      } else {
        console.log(`✓ Added course: ${courseData.courseId} - ${courseData.name}`);
        addedCount++;
      }

    } catch (error) {
      console.error(`✗ Failed to add course ${courseData.courseId}:`, error.message);
      skippedCount++;
    }
  }

  console.log(`\nCourse addition completed!`);
  console.log(`✓ Added: ${addedCount} courses`);
  console.log(`✓ Updated: ${updatedCount} courses`);
  console.log(`✗ Skipped: ${skippedCount} courses`);

  // Get updated total count
  try {
    const totalResult = await dynamodb
      .scan({
        TableName: COURSES_TABLE,
        Select: "COUNT",
      })
      .promise();

    console.log(`📊 Total courses in database: ${totalResult.Count}`);
  } catch (error) {
    console.error("Error getting total count:", error.message);
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node add-courses.js [courses-file.json] [--overwrite]

Example courses file format:
[
  {
    "courseId": "CSE101",
    "category": "CSE",
    "name": "Introduction to Computer Programming",
    "description": "Basic programming concepts",
    "gradingScheme": {
      "description": "Final exam 60%, Projects 40%",
      "lastModified": "2024-01-01T00:00:00Z",
      "modifiedBy": "admin"
    }
  }
]

Options:
  --overwrite    Update existing courses instead of skipping them

Or modify this script to include your courses data directly.
    `);
    process.exit(1);
  }

  const fs = require('fs');
  let coursesFile = args[0];
  let options = {};

  // Parse command line options
  if (args.includes('--overwrite')) {
    options.overwrite = true;
  }

  try {
    const coursesData = JSON.parse(fs.readFileSync(coursesFile, 'utf8'));
    addCourses(coursesData, options).catch(console.error);
  } catch (error) {
    console.error("Error reading courses file:", error.message);
    process.exit(1);
  }
}

module.exports = { addCourses };