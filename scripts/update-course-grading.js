const AWS = require("aws-sdk");

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";
const COURSES_TABLE = `pickyourcourses-${STAGE}-courses`;

/**
 * Update course grading schemes
 * @param {Array|Object} updates - Course grading updates
 * @param {Object} options - Additional options
 */
async function updateCourseGrading(updates, options = {}) {
  console.log("Updating course grading schemes...\n");

  try {
    let coursesToUpdate = [];

    // Handle different input formats
    if (Array.isArray(updates)) {
      coursesToUpdate = updates;
    } else if (updates.courseId) {
      // Single course update
      coursesToUpdate = [updates];
    } else {
      console.error("Invalid updates format. Expected array or single course object.");
      return;
    }

    let updatedCount = 0;
    let skippedCount = 0;
    let notFoundCount = 0;

    for (const update of coursesToUpdate) {
      if (!update.courseId) {
        console.error(`✗ Missing courseId in update:`, update);
        skippedCount++;
        continue;
      }

      console.log(`\nProcessing course: ${update.courseId}`);

      try {
        // Get existing course
        const result = await dynamodb.get({
          TableName: COURSES_TABLE,
          Key: { courseId: update.courseId }
        }).promise();

        if (!result.Item) {
          console.log(`  ✗ Course not found: ${update.courseId}`);
          notFoundCount++;
          continue;
        }

        const existingCourse = result.Item;
        console.log(`  → Found: ${existingCourse.name}`);

        // Prepare grading scheme update
        let newGradingScheme = { ...existingCourse.gradingScheme };

        if (update.gradingScheme) {
          if (typeof update.gradingScheme === 'string') {
            // Simple string description
            newGradingScheme.description = update.gradingScheme;
          } else if (typeof update.gradingScheme === 'object') {
            // Full grading scheme object
            if (update.gradingScheme.description) {
              newGradingScheme.description = update.gradingScheme.description;
            }
            if (update.gradingScheme.components) {
              // Handle legacy components format - convert to description
              const componentsText = update.gradingScheme.components
                .map(comp => `${comp.name}: ${comp.percentage}%`)
                .join(', ');
              newGradingScheme.description = componentsText;
            }
          }
        }

        // Always update metadata
        newGradingScheme.lastModified = new Date().toISOString();
        newGradingScheme.modifiedBy = update.modifiedBy || options.modifiedBy || "script";

        // Prepare update parameters
        const updateParams = {
          TableName: COURSES_TABLE,
          Key: { courseId: update.courseId },
          UpdateExpression: "SET gradingScheme = :gradingScheme",
          ExpressionAttributeValues: {
            ":gradingScheme": newGradingScheme
          }
        };

        if (!options.dryRun) {
          await dynamodb.update(updateParams).promise();
          console.log(`  ✓ Updated grading scheme`);
          console.log(`    Description: ${newGradingScheme.description}`);
        } else {
          console.log(`  ✓ Would update grading scheme (dry run)`);
          console.log(`    New description: ${newGradingScheme.description}`);
        }

        updatedCount++;

      } catch (error) {
        console.error(`  ✗ Failed to update ${update.courseId}:`, error.message);
        skippedCount++;
      }
    }

    console.log(`\n✅ Course grading update completed!`);
    console.log(`   Updated: ${updatedCount} courses`);
    console.log(`   Not found: ${notFoundCount} courses`);
    console.log(`   Skipped: ${skippedCount} courses`);

  } catch (error) {
    console.error("❌ Error updating course grading:", error);
    process.exit(1);
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node update-course-grading.js [config-file.json] [options]

Example config file format:
[
  {
    "courseId": "CSE101",
    "gradingScheme": "Final exam 60%, Projects 30%, Participation 10%",
    "modifiedBy": "admin"
  },
  {
    "courseId": "CSE102",
    "gradingScheme": {
      "description": "Midterm 40%, Final 40%, Homework 20%",
      "components": [
        { "name": "Midterm", "percentage": 40 },
        { "name": "Final", "percentage": 40 },
        { "name": "Homework", "percentage": 20 }
      ]
    }
  }
]

Or single course format:
{
  "courseId": "CSE101",
  "gradingScheme": "Final exam 60%, Projects 40%",
  "modifiedBy": "admin"
}

Options:
  --dry-run         Show what would be updated without actually doing it
  --modified-by     Set the modifiedBy field for all updates

Or modify this script to include your grading updates directly.
    `);
    process.exit(1);
  }

  const fs = require('fs');
  const configFile = args[0];
  let options = {};

  // Parse command line options
  if (args.includes('--dry-run')) {
    options.dryRun = true;
  }

  const modifiedByIndex = args.indexOf('--modified-by');
  if (modifiedByIndex !== -1 && args[modifiedByIndex + 1]) {
    options.modifiedBy = args[modifiedByIndex + 1];
  }

  try {
    const updates = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    updateCourseGrading(updates, options).catch(console.error);
  } catch (error) {
    console.error("Error reading config file:", error.message);
    process.exit(1);
  }
}

module.exports = { updateCourseGrading };