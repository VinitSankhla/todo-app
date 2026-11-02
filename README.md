# To-Do App

A per-user to-do list built with React + TypeScript + Vite + Tailwind CSS, backed by
AWS Amplify Gen 2 (Cognito auth + DynamoDB) in region **ap-south-1 (Mumbai)**.

> Work in progress — full setup, deployment and cost notes are added as the project is built.

## Local setup

Requires Node.js 22+ and npm.

```bash
npm install
npm run dev        # start the app at http://localhost:5173
```

## Scripts

| Command                | What it does                          |
| ---------------------- | ------------------------------------- |
| `npm run dev`          | Start the local development server    |
| `npm run build`        | Type-check and build for production   |
| `npm run lint`         | Check code with ESLint                |
| `npm run typecheck`    | Check TypeScript types                |
| `npm run format`       | Format all files with Prettier        |
| `npm run format:check` | Verify formatting without changing it |
| `npm test`             | Run unit tests once (Vitest)          |
| `npm run test:watch`   | Re-run tests automatically on changes |
