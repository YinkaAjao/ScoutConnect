// database.js - Updated with Conversations Table
const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0
});

async function initializeDatabase() {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS users (
                id INT AUTO_INCREMENT PRIMARY KEY,
                email VARCHAR(255) NOT NULL UNIQUE,
                password VARCHAR(255) NOT NULL,
                full_name VARCHAR(255),
                user_type ENUM('athlete', 'scout', 'admin') NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS athletes (
                user_id INT PRIMARY KEY,
                sport VARCHAR(100),
                position VARCHAR(100),
                age INT,
                height INT,
                weight INT,
                country VARCHAR(100),
                club VARCHAR(255),
                preferred_foot VARCHAR(10),
                achievements TEXT,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS scouts (
                user_id INT PRIMARY KEY,
                organization VARCHAR(255),
                scout_type VARCHAR(100),
                license_number VARCHAR(100),
                country VARCHAR(100),
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS conversations (
                id INT AUTO_INCREMENT PRIMARY KEY,
                sender_id INT NOT NULL,
                receiver_id INT NOT NULL,
                content TEXT,
                message_type ENUM('text', 'image', 'video', 'document') DEFAULT 'text',
                attachment_url VARCHAR(512),
                is_read BOOLEAN DEFAULT FALSE,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                FOREIGN KEY (sender_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (receiver_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_sender_receiver (sender_id, receiver_id),
                INDEX idx_receiver_unread (receiver_id, is_read),
                INDEX idx_created_at (created_at DESC)
            )
        `);

        // table for tracking active users (for online status)
        await pool.query(`
            CREATE TABLE IF NOT EXISTS user_activity (
                user_id INT PRIMARY KEY,
                last_active TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                is_online BOOLEAN DEFAULT TRUE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS athlete_stats (
                id INT AUTO_INCREMENT PRIMARY KEY,
                athlete_id INT NOT NULL,
                stat_name VARCHAR(100) NOT NULL,
                stat_value VARCHAR(100) NOT NULL,
                recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS shortlists (
                id INT AUTO_INCREMENT PRIMARY KEY,
                scout_id INT NOT NULL,
                athlete_id INT NOT NULL,
                notes TEXT,
                rating INT,
                status ENUM('interested', 'contacted', 'tryout', 'signed') DEFAULT 'interested',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (scout_id) REFERENCES scouts(user_id) ON DELETE CASCADE,
                FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE,
                UNIQUE KEY unique_shortlist (scout_id, athlete_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS scouting_reports (
                id INT AUTO_INCREMENT PRIMARY KEY,
                scout_id INT NOT NULL,
                athlete_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                content TEXT NOT NULL,
                strengths TEXT,
                weaknesses TEXT,
                potential_rating INT,
                recommendation TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (scout_id) REFERENCES scouts(user_id) ON DELETE CASCADE,
                FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS athlete_videos (
                id INT AUTO_INCREMENT PRIMARY KEY,
                athlete_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                url VARCHAR(512) NOT NULL,
                thumbnail_url VARCHAR(512),
                views INT DEFAULT 0,
                uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS events (
                id INT AUTO_INCREMENT PRIMARY KEY,
                organizer_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                event_type VARCHAR(100),
                location VARCHAR(255),
                start_date DATETIME NOT NULL,
                end_date DATETIME,
                registration_deadline DATETIME,
                max_participants INT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (organizer_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS event_participants (
                id INT AUTO_INCREMENT PRIMARY KEY,
                event_id INT NOT NULL,
                user_id INT NOT NULL,
                status ENUM('registered', 'attended', 'cancelled') DEFAULT 'registered',
                registered_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                UNIQUE KEY unique_participation (event_id, user_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS posts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                content TEXT NOT NULL,
                media_url VARCHAR(512),
                media_type ENUM('image', 'video'),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS likes (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                post_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE,
                UNIQUE KEY unique_like (user_id, post_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS comments (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                post_id INT NOT NULL,
                content TEXT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS shares (
                id INT AUTO_INCREMENT PRIMARY KEY,
                user_id INT NOT NULL,
                post_id INT NOT NULL,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                FOREIGN KEY (post_id) REFERENCES posts(id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS athlete_achievements (
                id INT AUTO_INCREMENT PRIMARY KEY,
                athlete_id INT NOT NULL,
                title VARCHAR(255) NOT NULL,
                description TEXT,
                date DATE NOT NULL,
                image_url VARCHAR(512),
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS scout_requests (
                id INT AUTO_INCREMENT PRIMARY KEY,
                scout_id INT NOT NULL,
                athlete_id INT NOT NULL,
                status ENUM('pending', 'accepted', 'rejected') DEFAULT 'pending',
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (scout_id) REFERENCES scouts(user_id) ON DELETE CASCADE,
                FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS athlete_scout_connections (
                id INT AUTO_INCREMENT PRIMARY KEY,
                athlete_id INT NOT NULL,
                scout_id INT NOT NULL,
                connected_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE,
                FOREIGN KEY (scout_id) REFERENCES scouts(user_id) ON DELETE CASCADE,
                UNIQUE KEY unique_connection (athlete_id, scout_id)
            )
        `);

        await pool.query(`
            CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        type ENUM('message', 'application', 'scout_interest', 'event', 'reaction', 'connection') NOT NULL,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        related_user_id INT,
        related_item_id INT,
        related_item_type VARCHAR(50),
        is_read BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (related_user_id) REFERENCES users(id) ON DELETE CASCADE,
        INDEX idx_user_unread (user_id, is_read),
        INDEX idx_created_at (created_at DESC)
    )
`);


        await pool.query(`
    CREATE TABLE IF NOT EXISTS profile_views (
        id INT AUTO_INCREMENT PRIMARY KEY,
        athlete_id INT NOT NULL,
        viewer_id INT NOT NULL,
        viewed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE,
        FOREIGN KEY (viewer_id) REFERENCES users(id) ON DELETE CASCADE,
        UNIQUE KEY unique_daily_view (athlete_id, viewer_id)
    )
`);

        await pool.query(`
    CREATE TABLE IF NOT EXISTS event_invites (
        id INT AUTO_INCREMENT PRIMARY KEY,
        event_id INT NOT NULL,
        athlete_id INT NOT NULL,
        scout_id INT NOT NULL,
        status ENUM('pending', 'accepted', 'declined') DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES events(id) ON DELETE CASCADE,
        FOREIGN KEY (athlete_id) REFERENCES athletes(user_id) ON DELETE CASCADE,
        FOREIGN KEY (scout_id) REFERENCES scouts(user_id) ON DELETE CASCADE
    )
`);

        console.log('Database tables initialized successfully');
    } catch (error) {
        console.error('Error initializing database:', error);
        throw error;
    }
}

module.exports = { pool, initializeDatabase };