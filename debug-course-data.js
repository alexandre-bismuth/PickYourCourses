const AWS = require("aws-sdk");

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || "us-east-1",
});

const STAGE = process.env.STAGE || "dev";
const TABLE_NAME = `pickyourcourses-${STAGE}-courses`;

async function checkCourseData() {
  try {
    console.log(`Checking course data in ${TABLE_NAME}...`);
    
    const result = await dynamodb.scan({
      TableName: TABLE_NAME,
      Limit: 3
    }).promise();

    if (result.Items && result.Items.length > 0) {
      console.log(`Found ${result.Items.length} courses. Sample data:`);
      result.Items.forEach((course, index) => {
        console.log(`\n--- Course ${index + 1}: ${course.courseId} ---`);
        console.log('Grading Scheme:', JSON.stringify(course.gradingScheme, null, 2));
      });
    } else {
      console.log("No courses found in the table");
    }
  } catch (error) {
    console.error("Error checking course data:", error.message);
  }
}

checkCourseData();