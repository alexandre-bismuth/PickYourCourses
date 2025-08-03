const AWS = require('aws-sdk');

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const STAGE = process.env.STAGE || 'dev';
const REVIEWS_TABLE = `pickyourcourses-${STAGE}-reviews`;
const USERS_TABLE = `pickyourcourses-${STAGE}-users`;

async function verifyReviews() {
  console.log('Verifying loaded reviews...\n');
  
  try {
    // Get all reviews
    const reviewsResult = await dynamodb.scan({
      TableName: REVIEWS_TABLE,
      FilterExpression: 'isDeleted = :isDeleted',
      ExpressionAttributeValues: {
        ':isDeleted': false
      }
    }).promise();
    
    const reviews = reviewsResult.Items || [];
    console.log(`Total reviews found: ${reviews.length}\n`);
    
    // Group by course
    const reviewsByCourse = {};
    for (const review of reviews) {
      if (!reviewsByCourse[review.courseId]) {
        reviewsByCourse[review.courseId] = [];
      }
      reviewsByCourse[review.courseId].push(review);
    }
    
    // Display summary by course
    for (const [courseId, courseReviews] of Object.entries(reviewsByCourse)) {
      console.log(`\n=== ${courseId} (${courseReviews.length} reviews) ===`);
      
      // Calculate averages
      const totals = courseReviews.reduce((acc, review) => ({
        overall: acc.overall + review.ratings.overall,
        quality: acc.quality + review.ratings.quality,
        difficulty: acc.difficulty + review.ratings.difficulty
      }), { overall: 0, quality: 0, difficulty: 0 });
      
      const count = courseReviews.length;
      const averages = {
        overall: (totals.overall / count).toFixed(1),
        quality: (totals.quality / count).toFixed(1),
        difficulty: (totals.difficulty / count).toFixed(1)
      };
      
      console.log(`Average ratings - Overall: ${averages.overall}, Quality: ${averages.quality}, Difficulty: ${averages.difficulty}`);
      console.log(`Anonymous reviews: ${courseReviews.filter(r => r.anonymous).length}`);
      console.log(`Named reviews: ${courseReviews.filter(r => !r.anonymous).length}`);
      
      // Show first few reviews
      console.log('\nSample reviews:');
      courseReviews.slice(0, 3).forEach((review, index) => {
        console.log(`  ${index + 1}. ${review.anonymous ? 'Anonymous' : 'Named'} - Overall: ${review.ratings.overall}/5`);
        const reviewText = review.text || 'No text provided';
        console.log(`     "${reviewText.substring(0, 100)}${reviewText.length > 100 ? '...' : ''}"`);
      });
    }
    
    // Get user count
    const usersResult = await dynamodb.scan({
      TableName: USERS_TABLE,
      ProjectionExpression: 'telegramId, displayName, isAnonymous'
    }).promise();
    
    const users = usersResult.Items || [];
    console.log(`\n\nTotal users created: ${users.length}`);
    console.log(`Anonymous users: ${users.filter(u => u.isAnonymous).length}`);
    console.log(`Named users: ${users.filter(u => !u.isAnonymous).length}`);
    
  } catch (error) {
    console.error('Error verifying reviews:', error.message);
  }
}

verifyReviews().catch(console.error);