const AWS = require("aws-sdk");

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";
const COURSES_TABLE = `pickyourcourses-${STAGE}-courses`;
const REVIEWS_TABLE = `pickyourcourses-${STAGE}-reviews`;

/**
 * Remove courses from the database
 * @param {Array|Object} searchCriteria - Course IDs to remove or search criteria
 * @param {Object} options - Additional options
 */
async function removeCourses(searchCriteria, options = {}) {
  console.log("Removing courses based on criteria...\n");

  try {
    let coursesToDelete = [];

    // Handle different input formats
    if (Array.isArray(searchCriteria)) {
      // Array of course IDs
      coursesToDelete = searchCriteria.map(courseId => ({ courseId }));
    } else if (typeof searchCriteria === 'string') {
      // Single course ID
      coursesToDelete = [{ courseId: searchCriteria }];
    } else if (typeof searchCriteria === 'object') {
      // Search criteria object
      console.log("Scanning for courses matching criteria...");
      
      const scanParams = {
        TableName: COURSES_TABLE,
      };

      // Build filter expression
      const filterExpressions = [];
      const expressionAttributeValues = {};

      if (searchCriteria.category) {
        filterExpressions.push("category = :category");
        expressionAttributeValues[":category"] = searchCriteria.category;
      }

      if (searchCriteria.nameContains) {
        filterExpressions.push("contains(#name, :nameContent)");
        scanParams.ExpressionAttributeNames = { "#name": "name" };
        expressionAttributeValues[":nameContent"] = searchCriteria.nameContains;
      }

      if (searchCriteria.courseIds && Array.isArray(searchCriteria.courseIds)) {
        const courseIdConditions = searchCriteria.courseIds.map((_, index) => {
          const key = `:courseId${index}`;
          expressionAttributeValues[key] = searchCriteria.courseIds[index];
          return `courseId = ${key}`;
        });
        filterExpressions.push(`(${courseIdConditions.join(" OR ")})`);
      }

      if (filterExpressions.length > 0) {
        scanParams.FilterExpression = filterExpressions.join(" AND ");
        scanParams.ExpressionAttributeValues = expressionAttributeValues;
      }

      const result = await dynamodb.scan(scanParams).promise();
      coursesToDelete = result.Items || [];
    }

    if (coursesToDelete.length === 0) {
      console.log("No courses found to delete.");
      return;
    }

    console.log(`Found ${coursesToDelete.length} course(s) to delete`);

    let deletedCount = 0;
    let skippedCount = 0;

    for (const course of coursesToDelete) {
      console.log(`\nProcessing course: ${course.courseId} - ${course.name || 'Unknown'}`);

      // Check if this course should be excluded
      if (options.exclude && options.exclude.includes(course.courseId)) {
        console.log(`  ✓ Skipped (excluded)`);
        skippedCount++;
        continue;
      }

      // Check for associated reviews
      if (options.checkReviews !== false) {
        try {
          const reviewsResult = await dynamodb.scan({
            TableName: REVIEWS_TABLE,
            FilterExpression: "courseId = :courseId",
            ExpressionAttributeValues: { ":courseId": course.courseId },
            Select: "COUNT"
          }).promise();

          if (reviewsResult.Count > 0) {
            if (options.deleteReviews) {
              console.log(`  → Found ${reviewsResult.Count} associated reviews, deleting them...`);
              
              // Get all reviews for deletion
              const allReviewsResult = await dynamodb.scan({
                TableName: REVIEWS_TABLE,
                FilterExpression: "courseId = :courseId",
                ExpressionAttributeValues: { ":courseId": course.courseId }
              }).promise();

              // Delete reviews in batches
              const batchSize = 25;
              const reviews = allReviewsResult.Items || [];
              for (let i = 0; i < reviews.length; i += batchSize) {
                const batch = reviews.slice(i, i + batchSize);
                const deleteRequests = batch.map((review) => ({
                  DeleteRequest: {
                    Key: { reviewId: review.reviewId },
                  },
                }));

                await dynamodb.batchWrite({
                  RequestItems: {
                    [REVIEWS_TABLE]: deleteRequests,
                  },
                }).promise();
              }
            } else {
              console.log(`  ⚠ Warning: Course has ${reviewsResult.Count} associated reviews. Use --delete-reviews to remove them.`);
              if (!options.force) {
                console.log(`  ✗ Skipped (has reviews, use --force to delete anyway)`);
                skippedCount++;
                continue;
              }
            }
          }
        } catch (reviewError) {
          console.log(`  ⚠ Warning: Could not check for reviews: ${reviewError.message}`);
        }
      }

      if (!options.dryRun) {
        // Delete the course
        await dynamodb.delete({
          TableName: COURSES_TABLE,
          Key: { courseId: course.courseId }
        }).promise();

        console.log(`  ✓ Deleted successfully`);
      } else {
        console.log(`  ✓ Would delete (dry run)`);
      }

      deletedCount++;
    }

    console.log(`\n✅ Course removal completed!`);
    console.log(`   Deleted: ${deletedCount} courses`);
    console.log(`   Skipped: ${skippedCount} courses`);

    // Get updated total count
    if (!options.dryRun) {
      try {
        const totalResult = await dynamodb
          .scan({
            TableName: COURSES_TABLE,
            Select: "COUNT",
          })
          .promise();

        console.log(`📊 Total courses remaining in database: ${totalResult.Count}`);
      } catch (error) {
        console.error("Error getting total count:", error.message);
      }
    }

  } catch (error) {
    console.error("❌ Error removing courses:", error);
    process.exit(1);
  }
}

// Command line interface
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length === 0) {
    console.log(`
Usage: node remove-courses.js [config-file.json] [options]

Example config file format:
{
  "searchCriteria": {
    "courseIds": ["CSE101", "CSE102"],
    "category": "CSE",
    "nameContains": "Introduction"
  },
  "options": {
    "dryRun": false,
    "force": false,
    "deleteReviews": false,
    "checkReviews": true,
    "exclude": ["CSE103", "CSE104"]
  }
}

Or pass a simple array of course IDs:
["CSE101", "CSE102", "CSE103"]

Options:
  --dry-run         Show what would be deleted without actually doing it
  --force           Delete courses even if they have associated reviews
  --delete-reviews  Delete associated reviews along with courses
  --no-check        Skip checking for associated reviews

Or modify this script to include your deletion configuration directly.
    `);
    process.exit(1);
  }

  const fs = require('fs');
  const configFile = args[0];
  let options = {};

  // Parse command line options
  if (args.includes('--dry-run')) options.dryRun = true;
  if (args.includes('--force')) options.force = true;
  if (args.includes('--delete-reviews')) options.deleteReviews = true;
  if (args.includes('--no-check')) options.checkReviews = false;

  try {
    const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
    
    let searchCriteria;
    if (Array.isArray(config)) {
      // Simple array of course IDs
      searchCriteria = config;
    } else if (config.searchCriteria) {
      // Full config object
      searchCriteria = config.searchCriteria;
      options = { ...options, ...(config.options || {}) };
    } else {
      // Assume it's search criteria object
      searchCriteria = config;
    }
    
    removeCourses(searchCriteria, options).catch(console.error);
  } catch (error) {
    console.error("Error reading config file:", error.message);
    process.exit(1);
  }
}

module.exports = { removeCourses };