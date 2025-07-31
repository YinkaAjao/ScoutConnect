# ScoutConnect Project Setup Guide

## Project Overview
ScoutConnect is a full-stack application with separate frontend and backend directories. The project structure includes:
- **Frontend**: Contains athlete and scoutrelated functionality and UI components
- **Backend**: Contains server-side logic, database configuration, and API endpoints

## Prerequisites

Before setting up the project, ensure you have the following installed:

1. **Node.js** (version 14 or higher)
   - Download from [nodejs.org](https://nodejs.org/)
   - Verify installation: `node --version` and `npm --version`

2. **Git**
   - Download from [git-scm.com](https://git-scm.com/)
   - Verify installation: `git --version`

3. **Database** (MySQL)
   - Install MySQL 

## Step-by-Step Setup Instructions

### Step 1: Clone the Repository
```bash
git clone https://github.com/YinkaAjao/ScoutConnect.git
cd ScoutConnect
```

### Step 2: Backend Setup

1. **Navigate to the backend directory:**
   ```bash
   cd backend
   ```

2. **Install backend dependencies:**
   ```bash
   npm install
   ```

3. **Configure environment variables:**
   - The repository includes a `.env` file in the backend directory
   - Open the `.env` file and configure the following (typical configuration):
   ```env
   PORT=5000
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=your_database_username
   DB_PASSWORD=your_database_password
   DB_NAME=scoutconnect_db
   JWT_SECRET=your_jwt_secret_key
   ```

4. **Set up the database:**
   - Create a new database named `scoutconnect_db` (or as specified in .env)
   - Run any migration scripts if available in the backend directory

5. **Start the backend server:**
   node server.js

### Step 3: Frontend Setup

1. **Open a new terminal and navigate to the frontend directory:**
   ```bash
   cd frontend
   ```

2. **Install Tailwind CSS and required dependencies:**
  npm install -D tailwindcss postcss autoprefixer
  npx tailwindcss init -p

3. **Run live server:**
  Navigate to index.html and run live server

If you encounter issues:

1. **Port conflicts:** Change ports in configuration files
2. **Database connection errors:** Verify database credentials and ensure database server is running
3. **Missing dependencies:** Run `npm install` in both frontend and backend directories
4. **CORS errors:** Ensure backend is configured to allow requests from frontend URL

## Alternative Setup (Using package managers)


## Development Workflow

1. Keep both frontend and backend servers running 
2. Backend typically runs on port 3000
3. Make sure database is created before starting the backend
