const AWS = require('aws-sdk');

// Configure AWS
const dynamodb = new AWS.DynamoDB.DocumentClient({
  region: process.env.AWS_REGION || 'us-east-1'
});

const STAGE = process.env.STAGE || 'dev';
const TABLE_NAME = `pickyourcourses-${STAGE}-courses`;

// École Polytechnique course data
const courses = [
  // MAA - Mathematics
  { courseId: 'MAA101', category: 'MAA', name: 'Analysis I', description: 'Introduction to mathematical analysis' },
  { courseId: 'MAA102', category: 'MAA', name: 'Analysis II', description: 'Advanced mathematical analysis' },
  { courseId: 'MAA103', category: 'MAA', name: 'Linear Algebra', description: 'Vector spaces and linear transformations' },
  { courseId: 'MAA104', category: 'MAA', name: 'Probability', description: 'Introduction to probability theory' },
  
  // PHY - Physics
  { courseId: 'PHY101', category: 'PHY', name: 'Mechanics', description: 'Classical mechanics and dynamics' },
  { courseId: 'PHY102', category: 'PHY', name: 'Electromagnetism', description: 'Electric and magnetic fields' },
  { courseId: 'PHY103', category: 'PHY', name: 'Thermodynamics', description: 'Heat and energy transfer' },
  { courseId: 'PHY104', category: 'PHY', name: 'Quantum Physics', description: 'Introduction to quantum mechanics' },
  
  // CSE - Computer Science
  { courseId: 'CSE101', category: 'CSE', name: 'Programming Fundamentals', description: 'Introduction to programming' },
  { courseId: 'CSE102', category: 'CSE', name: 'Data Structures', description: 'Algorithms and data structures' },
  { courseId: 'CSE103', category: 'CSE', name: 'Computer Architecture', description: 'Hardware and system design' },
  { courseId: 'CSE104', category: 'CSE', name: 'Software Engineering', description: 'Software development methodologies' },
  
  // ECO - Economics
  { courseId: 'ECO101', category: 'ECO', name: 'Microeconomics', description: 'Individual and firm behavior' },
  { courseId: 'ECO102', category: 'ECO', name: 'Macroeconomics', description: 'National and global economics' },
  { courseId: 'ECO103', category: 'ECO', name: 'Econometrics', description: 'Statistical analysis in economics' },
  
  // LAB - Laboratory
  { courseId: 'LAB101', category: 'LAB', name: 'Physics Lab I', description: 'Experimental physics methods' },
  { courseId: 'LAB102', category: 'LAB', name: 'Chemistry Lab', description: 'Chemical analysis and synthesis' },
  { courseId: 'LAB103', category: 'LAB', name: 'Biology Lab', description: 'Biological research techniques' },
  
  // HSS - Humanities and Social Sciences
  { courseId: 'HSS101', category: 'HSS', name: 'Philosophy', description: 'Introduction to philosophical thinking' },
  { courseId: 'HSS102', category: 'HSS', name: 'History of Science', description: 'Evolution of scientific thought' },
  { courseId: 'HSS103', category: 'HSS', name: 'Ethics', description: 'Moral philosophy and decision making' },
  
  // PDV - Personal Development
  { courseId: 'PDV101', category: 'PDV', name: 'Leadership', description: 'Leadership skills and team management' },
  { courseId: 'PDV102', category: 'PDV', name: 'Communication', description: 'Effective communication techniques' },
  
  // BIO - Biology
  { courseId: 'BIO101', category: 'BIO', name: 'Cell Biology', description: 'Structure and function of cells' },
  { courseId: 'BIO102', category: 'BIO', name: 'Genetics', description: 'Heredity and genetic variation' },
  
  // CHEM - Chemistry
  { courseId: 'CHEM101', category: 'CHEM', name: 'General Chemistry', description: 'Chemical principles and reactions' },
  { courseId: 'CHEM102', category: 'CHEM', name: 'Organic Chemistry', description: 'Carbon-based compounds' },
  
  // SPOFAL - Sports and Physical Activities
  { courseId: 'SPOFAL101', category: 'SPOFAL', name: 'Team Sports', description: 'Collaborative physical activities' },
  { courseId: 'SPOFAL102', category: 'SPOFAL', name: 'Individual Sports', description: 'Personal fitness and athletics' },
  
  // PRL - Projects
  { courseId: 'PRL101', category: 'PRL', name: 'Research Project', description: 'Independent research work' },
  { courseId: 'PRL102', category: 'PRL', name: 'Engineering Project', description: 'Applied engineering solutions' }
];

async function loadCourses() {
  console.log(`Loading ${courses.length} courses into ${TABLE_NAME}...`);
  
  for (const course of courses) {
    const item = {
      ...course,
      averageRatings: {
        overall: 0,
        quality: 0,
        difficulty: 0
      },
      reviewCount: 0,
      gradingScheme: {
        components: [
          { name: 'Midterm', percentage: 40 },
          { name: 'Final', percentage: 50 },
          { name: 'Homework', percentage: 10 }
        ],
        lastModified: new Date().toISOString(),
        modifiedBy: 'system'
      }
    };
    
    try {
      await dynamodb.put({
        TableName: TABLE_NAME,
        Item: item,
        ConditionExpression: 'attribute_not_exists(courseId)' // Don't overwrite existing
      }).promise();
      
      console.log(`✓ Loaded course: ${course.courseId} - ${course.name}`);
    } catch (error) {
      if (error.code === 'ConditionalCheckFailedException') {
        console.log(`- Course already exists: ${course.courseId}`);
      } else {
        console.error(`✗ Failed to load course ${course.courseId}:`, error.message);
      }
    }
  }
  
  console.log('Course loading completed!');
}

loadCourses().catch(console.error);
