# PickYourCourses Telegram Bot

A Telegram bot for École Polytechnique students to share and read course reviews. This project was built with the [kiro](https://kiro.dev/) IDE as well as GitHub Copilot.

## Project Structure

```
src/
├── handlers/          # Telegram webhook handlers
├── models/           # TypeScript interfaces and data models
├── services/         # Business logic services
└── utils/           # Utility functions
```

## Development

### Prerequisites

- Node.js 18+
- npm

### Setup

```bash
npm install
```

### Available Scripts

- `npm run build` - Compile TypeScript to JavaScript
- `npm run dev` - Run in development mode with ts-node
- `npm start` - Run the compiled JavaScript
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Run ESLint with auto-fix
- `npm run clean` - Remove compiled files
- `npm run deploy:dev` - Deploy to development environment
- `npm run deploy:prod` - Deploy to production environment

### Building

```bash
npm run build
```

The compiled files will be in the `dist/` directory.

## Architecture

This bot is designed to run on AWS Lambda with:

- **DynamoDB** for data persistence
- **API Gateway** for webhook handling
- **CloudWatch** for logging and monitoring

## Features

- Course review system with ratings (overall, quality, difficulty)
- Course categorization and browsing
- Voting system for reviews
- Administrative functions
- Rate limiting and session management
