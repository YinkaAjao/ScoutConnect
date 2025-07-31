// server.js
const express = require('express');
const cors = require('cors');
const bodyParser = require('body-parser');
const { pool, initializeDatabase } = require('./database');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(cors({
  origin: true,
  credentials: true,
  allowedHeaders: ['Content-Type', 'Authorization']
}));
app.use(bodyParser.json());
app.use(express.static('public'));

// JWT Secret
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';

// Authentication middleware
const authenticate = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];

  if (!token) {
    return res.status(401).json({
      error: 'Unauthorized',
      message: 'No token provided',
      redirect: '/login'
    });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if token is expired
    if (decoded.exp * 1000 < Date.now()) {
      return res.status(401).json({
        error: 'Token expired',
        message: 'Your session has expired',
        redirect: '/login'
      });
    }

    req.user = decoded;
    next();
  } catch (error) {
    res.status(401).json({
      error: 'Invalid token',
      message: 'Invalid authentication token',
      redirect: '/login'
    });
  }
};

// Initialize database and start server
async function startServer() {
  try {
    await initializeDatabase();

    // Auth Routes
    app.post('/api/register', async (req, res) => {
      const { email, password, full_name, user_type, ...profileData } = req.body;

      try {
        // Check if user exists
        const [existing] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (existing.length) {
          return res.status(400).json({ error: 'Email already in use' });
        }

        // Hash password
        const hashedPassword = await bcrypt.hash(password, 10);

        // Create user
        const [result] = await pool.query(
          'INSERT INTO users (email, password, full_name, user_type) VALUES (?, ?, ?, ?)',
          [email, hashedPassword, full_name, user_type]
        );

        const userId = result.insertId;

        // Create profile based on user type
        if (user_type === 'athlete') {
          await pool.query(
            'INSERT INTO athletes (user_id, sport, age, country, club, preferred_foot, achievements) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [userId, profileData.sport, profileData.age, profileData.country, profileData.club || null, profileData.preferred_foot || null, profileData.achievements || null]
          );
        } else if (user_type === 'scout') {
          await pool.query(
            'INSERT INTO scouts (user_id, organization, scout_type, license_number, country) VALUES (?, ?, ?, ?, ?)',
            [userId, profileData.organization, profileData.scoutType, profileData.license || null, profileData.country]
          );
        }

        // Generate JWT
        const token = jwt.sign({ id: userId, email, user_type }, JWT_SECRET, { expiresIn: '1d' });

        res.status(201).json({ token, user: { id: userId, email, full_name, user_type } });
      } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
      }
    });

    app.post('/api/login', async (req, res) => {
      const { email, password } = req.body;

      try {
        const [users] = await pool.query('SELECT * FROM users WHERE email = ?', [email]);
        if (!users.length) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        const user = users[0];
        const passwordMatch = await bcrypt.compare(password, user.password);
        if (!passwordMatch) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }

        // Generate JWT
        const token = jwt.sign({ id: user.id, email: user.email, user_type: user.user_type }, JWT_SECRET, { expiresIn: '1d' });

        res.json({ token, user: { id: user.id, email: user.email, full_name: user.full_name, user_type: user.user_type } });
      } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
      }
    });

    app.get('/api/validate-token', authenticate, (req, res) => {
      res.json({ valid: true });
    });

    app.post('/api/refresh-token', async (req, res) => {
      const { refreshToken } = req.body;

      try {
        const decoded = jwt.verify(refreshToken, JWT_SECRET);
        const newToken = jwt.sign(
          { id: decoded.id, email: decoded.email, user_type: decoded.user_type },
          JWT_SECRET,
          { expiresIn: '1d' }
        );

        res.json({ token: newToken });
      } catch (error) {
        res.status(401).json({ error: 'Invalid refresh token' });
      }
    });

    // User Profile Routes
    app.get('/api/profile', authenticate, async (req, res) => {
      try {
        const userId = req.user.id;

        // Get user basic info
        const [users] = await pool.query('SELECT id, email, full_name, user_type FROM users WHERE id = ?', [userId]);
        if (!users.length) {
          return res.status(404).json({ error: 'User not found' });
        }

        const user = users[0];
        let profile = {};

        // Get profile details based on user type
        if (user.user_type === 'athlete') {
          const [athletes] = await pool.query('SELECT * FROM athletes WHERE user_id = ?', [userId]);
          if (athletes.length) {
            profile = athletes[0];
          }

          // Get athlete stats
          const [stats] = await pool.query('SELECT * FROM athlete_stats WHERE athlete_id = ?', [userId]);
          profile.stats = stats;

          // Get videos
          const [videos] = await pool.query('SELECT * FROM athlete_videos WHERE athlete_id = ?', [userId]);
          profile.videos = videos;

        } else if (user.user_type === 'scout') {
          const [scouts] = await pool.query('SELECT * FROM scouts WHERE user_id = ?', [userId]);
          if (scouts.length) {
            profile = scouts[0];
          }

          // Get shortlisted athletes count
          const [shortlists] = await pool.query('SELECT COUNT(*) as count FROM shortlists WHERE scout_id = ?', [userId]);
          profile.shortlisted_count = shortlists[0].count;

          // Get reports count
          const [reports] = await pool.query('SELECT COUNT(*) as count FROM scouting_reports WHERE scout_id = ?', [userId]);
          profile.reports_count = reports[0].count;
        }

        res.json({ ...user, profile });
      } catch (error) {
        console.error('Profile fetch error:', error);
        res.status(500).json({ error: 'Failed to fetch profile' });
      }
    });

    app.put('/api/profile', authenticate, async (req, res) => {
      try {
        const userId = req.user.id;
        const { full_name, ...profileData } = req.body;

        // Update user basic info
        if (full_name) {
          await pool.query('UPDATE users SET full_name = ? WHERE id = ?', [full_name, userId]);
        }

        // Get user type
        const [users] = await pool.query('SELECT user_type FROM users WHERE id = ?', [userId]);
        if (!users.length) {
          return res.status(404).json({ error: 'User not found' });
        }

        const userType = users[0].user_type;

        // Update profile based on user type
        if (userType === 'athlete') {
          await pool.query(
            `UPDATE athletes SET 
              sport = COALESCE(?, sport),
              age = COALESCE(?, age),
              height = COALESCE(?, height),
              weight = COALESCE(?, weight),
              country = COALESCE(?, country),
              club = COALESCE(?, club),
              preferred_foot = COALESCE(?, preferred_foot),
              achievements = COALESCE(?, achievements)
            WHERE user_id = ?`,
            [
              profileData.sport,
              profileData.age,
              profileData.height,
              profileData.weight,
              profileData.country,
              profileData.club,
              profileData.preferred_foot,
              profileData.achievements,
              userId
            ]
          );

          // Update stats if provided
          if (profileData.stats && Array.isArray(profileData.stats)) {
            for (const stat of profileData.stats) {
              await pool.query(
                'INSERT INTO athlete_stats (athlete_id, stat_name, stat_value) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE stat_value = VALUES(stat_value)',
                [userId, stat.stat_name, stat.stat_value]
              );
            }
          }
        } else if (userType === 'scout') {
          await pool.query(
            `UPDATE scouts SET 
              organization = COALESCE(?, organization),
              scout_type = COALESCE(?, scout_type),
              license_number = COALESCE(?, license_number),
              country = COALESCE(?, country)
            WHERE user_id = ?`,
            [
              profileData.organization,
              profileData.scout_type,
              profileData.license_number,
              profileData.country,
              userId
            ]
          );
        }

        res.json({ message: 'Profile updated successfully' });
      } catch (error) {
        console.error('Profile update error:', error);
        res.status(500).json({ error: 'Failed to update profile' });
      }
    });

    // Get athletes with filtering
    app.get('/api/athletes', authenticate, async (req, res) => {
      try {
        // Only scouts can access this endpoint
        if (req.user.user_type !== 'scout') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const { sport, age_min, age_max, country, position, sort } = req.query;

        let query = `
            SELECT 
                u.id,
                u.full_name,
                a.sport,
                a.position,
                a.age,
                a.height,
                a.weight,
                a.country,
                a.club,
                (SELECT url FROM athlete_videos WHERE athlete_id = u.id LIMIT 1) as video_url,
                (SELECT AVG(rating) FROM shortlists WHERE athlete_id = u.id) as rating,
                EXISTS(SELECT 1 FROM shortlists WHERE scout_id = ? AND athlete_id = u.id) as is_shortlisted,
                EXISTS(SELECT 1 FROM user_activity WHERE user_id = u.id AND is_online = TRUE) as is_online
            FROM users u
            JOIN athletes a ON u.id = a.user_id
            WHERE u.user_type = 'athlete'
        `;

        const params = [req.user.id];

        if (sport) {
          query += ' AND a.sport = ?';
          params.push(sport);
        }

        if (age_min) {
          query += ' AND a.age >= ?';
          params.push(parseInt(age_min));
        }

        if (age_max) {
          query += ' AND a.age <= ?';
          params.push(parseInt(age_max));
        }

        if (country) {
          query += ' AND a.country = ?';
          params.push(country);
        }

        if (position) {
          query += ' AND a.position = ?';
          params.push(position);
        }

        // Add sorting
        if (sort === 'rating') {
          query += ' ORDER BY rating DESC NULLS LAST';
        } else {
          query += ' ORDER BY u.created_at DESC';
        }

        query += ' LIMIT 50';

        const [athletes] = await pool.query(query, params);

        // Get stats for each athlete
        for (const athlete of athletes) {
          const [stats] = await pool.query(
            'SELECT stat_name, stat_value FROM athlete_stats WHERE athlete_id = ? LIMIT 4',
            [athlete.id]
          );
          athlete.stats = stats;
          athlete.profile_pic = `/images/profiles/${athlete.id}.jpg`;
        }

        res.json(athletes);
      } catch (error) {
        console.error('Athlete discovery error:', error);
        res.status(500).json({ error: 'Failed to fetch athletes' });
      }
    });

    // Rate an athlete
    app.post('/api/athletes/:id/rate', authenticate, async (req, res) => {
      try {
        // Only scouts can access this endpoint
        if (req.user.user_type !== 'scout') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const athleteId = req.params.id;
        const { rating } = req.body;

        // Check if athlete exists
        const [athlete] = await pool.query('SELECT 1 FROM athletes WHERE user_id = ?', [athleteId]);
        if (!athlete.length) {
          return res.status(404).json({ error: 'Athlete not found' });
        }

        // Update or insert rating
        await pool.query(
          `INSERT INTO shortlists (scout_id, athlete_id, rating)
             VALUES (?, ?, ?)
             ON DUPLICATE KEY UPDATE rating = VALUES(rating)`,
          [req.user.id, athleteId, rating]
        );

        res.json({ message: 'Rating saved successfully' });
      } catch (error) {
        console.error('Rating error:', error);
        res.status(500).json({ error: 'Failed to save rating' });
      }
    });

    // Get scouting activity
    app.get('/api/scouting-activity', authenticate, async (req, res) => {
      try {
        // Only scouts can access this endpoint
        if (req.user.user_type !== 'scout') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const [activity] = await pool.query(`
            SELECT 
                u.id as scout_id,
                u.full_name as scout_name,
                a.id as athlete_id,
                a.full_name as athlete_name,
                'viewed' as action,
                MAX(v.timestamp) as timestamp
            FROM profile_views v
            JOIN users u ON v.scout_id = u.id
            JOIN users a ON v.athlete_id = a.id
            WHERE v.scout_id IN (
                SELECT scout_id FROM athlete_scout_connections 
                WHERE athlete_id IN (
                    SELECT athlete_id FROM shortlists WHERE scout_id = ?
                )
            )
            GROUP BY u.id, a.id
            UNION
            SELECT 
                s.scout_id,
                u.full_name as scout_name,
                s.athlete_id,
                a.full_name as athlete_name,
                CASE 
                    WHEN s.status = 'interested' THEN 'shortlisted'
                    WHEN s.status = 'contacted' THEN 'contacted'
                    WHEN s.status = 'tryout' THEN 'invited to tryout'
                    WHEN s.status = 'signed' THEN 'signed'
                END as action,
                s.created_at as timestamp
            FROM shortlists s
            JOIN users u ON s.scout_id = u.id
            JOIN users a ON s.athlete_id = a.id
            WHERE s.scout_id IN (
                SELECT scout_id FROM athlete_scout_connections 
                WHERE athlete_id IN (
                    SELECT athlete_id FROM shortlists WHERE scout_id = ?
                )
            )
            UNION
            SELECT 
                r.scout_id,
                u.full_name as scout_name,
                r.athlete_id,
                a.full_name as athlete_name,
                'created report on' as action,
                r.created_at as timestamp
            FROM scouting_reports r
            JOIN users u ON r.scout_id = u.id
            JOIN users a ON r.athlete_id = a.id
            WHERE r.scout_id IN (
                SELECT scout_id FROM athlete_scout_connections 
                WHERE athlete_id IN (
                    SELECT athlete_id FROM shortlists WHERE scout_id = ?
                )
            )
            ORDER BY timestamp DESC
            LIMIT 5
        `, [req.user.id, req.user.id, req.user.id]);

        res.json(activity);
      } catch (error) {
        console.error('Scouting activity error:', error);
        res.status(500).json({ error: 'Failed to fetch scouting activity' });
      }
    });

    // Get shortlist stats
    app.get('/api/shortlists/stats', authenticate, async (req, res) => {
      try {
        // Only scouts can access this endpoint
        if (req.user.user_type !== 'scout') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const [stats] = await pool.query(`
            SELECT 
                COUNT(*) as total,
                SUM(CASE WHEN status = 'contacted' THEN 1 ELSE 0 END) as contacted,
                SUM(CASE WHEN status = 'tryout' THEN 1 ELSE 0 END) as tryouts,
                SUM(CASE WHEN status = 'signed' THEN 1 ELSE 0 END) as signed
            FROM shortlists
            WHERE scout_id = ?
        `, [req.user.id]);

        res.json(stats[0]);
      } catch (error) {
        console.error('Shortlist stats error:', error);
        res.status(500).json({ error: 'Failed to fetch shortlist stats' });
      }
    });

    // Get upcoming events
    app.get('/api/events/upcoming', authenticate, async (req, res) => {
      try {
        const [events] = await pool.query(`
            SELECT 
                e.id,
                e.title,
                e.description,
                e.location,
                e.start_date,
                COUNT(ep.id) as attendees,
                s.organization
            FROM events e
            JOIN scouts s ON e.organizer_id = s.user_id
            LEFT JOIN event_participants ep ON e.id = ep.event_id
            WHERE e.start_date > NOW()
            AND (e.organizer_id = ? OR e.id IN (
                SELECT event_id FROM event_participants WHERE user_id = ?
            ))
            GROUP BY e.id
            ORDER BY e.start_date ASC
            LIMIT 5
        `, [req.user.id, req.user.id]);

        res.json(events);
      } catch (error) {
        console.error('Upcoming events error:', error);
        res.status(500).json({ error: 'Failed to fetch upcoming events' });
      }
    });

    app.get('/api/scouts/random', authenticate, async (req, res) => {
      try {
        // Only athletes can access this endpoint
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        // Get 5 random scouts that the athlete isn't already connected to
        const [scouts] = await pool.query(`
            SELECT 
                u.id,
                s.organization,
                s.scout_type,
                s.country,
                u.full_name
            FROM scouts s
            JOIN users u ON s.user_id = u.id
            LEFT JOIN athlete_scout_connections asc ON s.user_id = asc.scout_id AND asc.athlete_id = ?
            WHERE asc.scout_id IS NULL
            ORDER BY RAND()
            LIMIT 5
        `, [req.user.id]);

        const formattedScouts = scouts.map(scout => ({
          id: scout.id,
          organization: scout.organization,
          scout_type: scout.scout_type,
          country: scout.country,
          full_name: scout.full_name,
          profile_pic: `/images/profiles/${scout.id}.jpg`
        }));

        res.json(formattedScouts);
      } catch (error) {
        console.error('Error fetching random scouts:', error);
        res.status(500).json({ error: 'Failed to fetch random scouts' });
      }
    });

    // Shortlist Routes
    app.post('/api/shortlists', authenticate, async (req, res) => {
      try {
        // Only scouts can access this endpoint
        if (req.user.user_type !== 'scout') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const { athlete_id, notes, rating } = req.body;

        // Check if athlete exists
        const [athletes] = await pool.query('SELECT 1 FROM athletes WHERE user_id = ?', [athlete_id]);
        if (!athletes.length) {
          return res.status(404).json({ error: 'Athlete not found' });
        }

        // Add to shortlist
        await pool.query(
          'INSERT INTO shortlists (scout_id, athlete_id, notes, rating) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE notes = VALUES(notes), rating = VALUES(rating)',
          [req.user.id, athlete_id, notes || null, rating || null]
        );

        res.status(201).json({ message: 'Athlete added to shortlist' });
      } catch (error) {
        console.error('Shortlist error:', error);
        res.status(500).json({ error: 'Failed to add to shortlist' });
      }
    });

    // Add these endpoints to your server.js after the existing routes

    // Get athlete posts
    app.get('/api/posts', authenticate, async (req, res) => {
      try {
        const userId = req.user.id;

        // Get posts from athlete and scouts they follow
        const [posts] = await pool.query(`
      SELECT 
        p.id, 
        p.content, 
        p.media_url, 
        p.media_type, 
        p.created_at,
        u.id as author_id,
        u.full_name as author_name,
        u.user_type as author_type,
        s.organization as scout_organization,
        COUNT(l.id) as likes_count,
        COUNT(c.id) as comments_count,
        COUNT(sh.id) as shares_count,
        MAX(CASE WHEN l.user_id = ? THEN 1 ELSE 0 END) as is_liked
      FROM posts p
      JOIN users u ON p.user_id = u.id
      LEFT JOIN scouts s ON u.id = s.user_id AND u.user_type = 'scout'
      LEFT JOIN likes l ON p.id = l.post_id
      LEFT JOIN comments c ON p.id = c.post_id
      LEFT JOIN shares sh ON p.id = sh.post_id
      WHERE p.user_id = ? OR p.user_id IN (
        SELECT scout_id FROM athlete_scout_connections WHERE athlete_id = ?
      )
      GROUP BY p.id
      ORDER BY p.created_at DESC
      LIMIT 20
    `, [userId, userId, userId]);

        const formattedPosts = posts.map(post => ({
          id: post.id,
          content: post.content,
          media: post.media_url ? {
            url: post.media_url,
            type: post.media_type
          } : null,
          timestamp: new Date(post.created_at).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
          }),
          author: {
            id: post.author_id,
            name: post.author_type === 'scout' ? post.scout_organization : post.author_name,
            profile_pic: `/images/profiles/${post.author_id}.jpg`,
            online: Math.random() > 0.3 // Random online status for demo
          },
          likes: post.likes_count,
          comments: post.comments_count,
          shares: post.shares_count,
          isLiked: post.is_liked,
          type: post.author_type
        }));

        res.json(formattedPosts);
      } catch (error) {
        console.error('Error fetching posts:', error);
        res.status(500).json({ error: 'Failed to fetch posts' });
      }
    });

    // Get all conversations for a user
    app.get('/api/conversations', authenticate, async (req, res) => {
      try {
        const userId = req.user.id;

        const [conversations] = await pool.query(`
      SELECT 
        other_user_id,
        other_user_name,
        other_user_type,
        scout_organization,
        athlete_sport,
        last_message_time,
        last_message,
        last_message_sender,
        unread_count
      FROM (
        SELECT DISTINCT
          CASE 
            WHEN c.sender_id = ? THEN c.receiver_id 
            ELSE c.sender_id 
          END as other_user_id,
          u.full_name as other_user_name,
          u.user_type as other_user_type,
          s.organization as scout_organization,
          a.sport as athlete_sport,
          MAX(c.created_at) OVER (PARTITION BY 
            CASE 
              WHEN c.sender_id = ? THEN c.receiver_id 
              ELSE c.sender_id 
            END
          ) as last_message_time,
          FIRST_VALUE(c.content) OVER (
            PARTITION BY 
              CASE 
                WHEN c.sender_id = ? THEN c.receiver_id 
                ELSE c.sender_id 
              END
            ORDER BY c.created_at DESC
          ) as last_message,
          FIRST_VALUE(c.sender_id) OVER (
            PARTITION BY 
              CASE 
                WHEN c.sender_id = ? THEN c.receiver_id 
                ELSE c.sender_id 
              END
            ORDER BY c.created_at DESC
          ) as last_message_sender,
          SUM(CASE WHEN c.receiver_id = ? AND c.is_read = FALSE THEN 1 ELSE 0 END) OVER (
            PARTITION BY 
              CASE 
                WHEN c.sender_id = ? THEN c.receiver_id 
                ELSE c.sender_id 
              END
          ) as unread_count,
          ROW_NUMBER() OVER (
            PARTITION BY 
              CASE 
                WHEN c.sender_id = ? THEN c.receiver_id 
                ELSE c.sender_id 
              END
            ORDER BY c.created_at DESC
          ) as rn
        FROM conversations c
        JOIN users u ON u.id = CASE WHEN c.sender_id = ? THEN c.receiver_id ELSE c.sender_id END
        LEFT JOIN scouts s ON u.id = s.user_id AND u.user_type = 'scout'
        LEFT JOIN athletes a ON u.id = a.user_id AND u.user_type = 'athlete'
        WHERE c.sender_id = ? OR c.receiver_id = ?
      ) AS ranked_conversations
      WHERE rn = 1
      ORDER BY last_message_time DESC
    `, [
          userId, userId, userId, userId, userId,
          userId, userId, userId, userId, userId
        ]);

        const formattedConversations = conversations.map(conv => ({
          userId: conv.other_user_id,
          name: conv.other_user_type === 'scout' ? conv.scout_organization : conv.other_user_name,
          userType: conv.other_user_type,
          sport: conv.athlete_sport,
          lastMessage: conv.last_message,
          lastMessageTime: new Date(conv.last_message_time).toLocaleString(),
          unreadCount: conv.unread_count,
          isOnline: Math.random() > 0.3,
          profilePic: `/images/profiles/${conv.other_user_id}.jpg`
        }));

        res.json(formattedConversations);
      } catch (error) {
        console.error('Error fetching conversations:', error);
        res.status(500).json({ error: 'Failed to fetch conversations' });
      }
    });

    // Get messages for a specific conversation
    app.get('/api/conversations/:userId/messages', authenticate, async (req, res) => {
      try {
        const currentUserId = req.user.id;
        const otherUserId = parseInt(req.params.userId);
        const page = parseInt(req.query.page) || 1;
        const limit = parseInt(req.query.limit) || 20;
        const offset = (page - 1) * limit;

        // Mark messages as read
        await pool.query(`
          UPDATE conversations 
          SET is_read = TRUE 
          WHERE sender_id = ? AND receiver_id = ?
        `, [otherUserId, currentUserId]);

        const [messages] = await pool.query(`
          SELECT 
            c.id,
            c.content,
            c.sender_id,
            c.receiver_id,
            c.message_type,
            c.attachment_url,
            c.created_at,
            c.is_read,
            u.full_name as sender_name,
            u.user_type as sender_type
          FROM conversations c
          JOIN users u ON c.sender_id = u.id
          WHERE (c.sender_id = ? AND c.receiver_id = ?) 
             OR (c.sender_id = ? AND c.receiver_id = ?)
          ORDER BY c.created_at DESC
          LIMIT ? OFFSET ?
        `, [currentUserId, otherUserId, otherUserId, currentUserId, limit, offset]);

        const formattedMessages = messages.reverse().map(msg => ({
          id: msg.id,
          content: msg.content,
          senderId: msg.sender_id,
          receiverId: msg.receiver_id,
          senderName: msg.sender_name,
          senderType: msg.sender_type,
          messageType: msg.message_type,
          attachmentUrl: msg.attachment_url,
          timestamp: new Date(msg.created_at).toLocaleString(),
          isRead: msg.is_read,
          isSentByMe: msg.sender_id === currentUserId
        }));

        // Get other user info
        const [otherUser] = await pool.query(`
          SELECT u.id, u.full_name, u.user_type, s.organization, a.sport
          FROM users u
          LEFT JOIN scouts s ON u.id = s.user_id AND u.user_type = 'scout'
          LEFT JOIN athletes a ON u.id = a.user_id AND u.user_type = 'athlete'
          WHERE u.id = ?
        `, [otherUserId]);

        const otherUserInfo = otherUser[0] ? {
          id: otherUser[0].id,
          name: otherUser[0].user_type === 'scout' ? otherUser[0].organization : otherUser[0].full_name,
          userType: otherUser[0].user_type,
          sport: otherUser[0].sport,
          profilePic: `/images/profiles/${otherUser[0].id}.jpg`,
          isOnline: Math.random() > 0.3
        } : null;

        res.json({
          messages: formattedMessages,
          otherUser: otherUserInfo,
          hasMore: messages.length === limit
        });
      } catch (error) {
        console.error('Error fetching messages:', error);
        res.status(500).json({ error: 'Failed to fetch messages' });
      }
    });

    // Send a new message
    app.post('/api/conversations/:userId/messages', authenticate, async (req, res) => {
      try {
        const senderId = req.user.id;
        const receiverId = parseInt(req.params.userId);
        const { content, messageType = 'text', attachmentUrl = null } = req.body;

        if (!content && !attachmentUrl) {
          return res.status(400).json({ error: 'Message content or attachment is required' });
        }

        // Verify receiver exists
        const [receiver] = await pool.query('SELECT id FROM users WHERE id = ?', [receiverId]);
        if (!receiver.length) {
          return res.status(404).json({ error: 'Receiver not found' });
        }

        // Insert message
        const [result] = await pool.query(`
          INSERT INTO conversations (sender_id, receiver_id, content, message_type, attachment_url)
          VALUES (?, ?, ?, ?, ?)
        `, [senderId, receiverId, content, messageType, attachmentUrl]);

        // Get the inserted message with sender info
        const [newMessage] = await pool.query(`
          SELECT 
            c.id,
            c.content,
            c.sender_id,
            c.receiver_id,
            c.message_type,
            c.attachment_url,
            c.created_at,
            c.is_read,
            u.full_name as sender_name,
            u.user_type as sender_type
          FROM conversations c
          JOIN users u ON c.sender_id = u.id
          WHERE c.id = ?
        `, [result.insertId]);

        const formattedMessage = {
          id: newMessage[0].id,
          content: newMessage[0].content,
          senderId: newMessage[0].sender_id,
          receiverId: newMessage[0].receiver_id,
          senderName: newMessage[0].sender_name,
          senderType: newMessage[0].sender_type,
          messageType: newMessage[0].message_type,
          attachmentUrl: newMessage[0].attachment_url,
          timestamp: new Date(newMessage[0].created_at).toLocaleString(),
          isRead: newMessage[0].is_read,
          isSentByMe: true
        };

        res.status(201).json(formattedMessage);
      } catch (error) {
        console.error('Error sending message:', error);
        res.status(500).json({ error: 'Failed to send message' });
      }
    });

    // Search users to start new conversation
    app.get('/api/users/search', authenticate, async (req, res) => {
      try {
        const { query, userType } = req.query;
        const currentUserId = req.user.id;
        const currentUserType = req.user.user_type;

        if (!query) {
          return res.status(400).json({ error: 'Search query is required' });
        }

        let searchQuery = `
          SELECT DISTINCT
            u.id,
            u.full_name,
            u.user_type,
            s.organization as scout_organization,
            s.scout_type,
            a.sport as athlete_sport,
            a.position as athlete_position,
            a.country as athlete_country
          FROM users u
          LEFT JOIN scouts s ON u.id = s.user_id AND u.user_type = 'scout'
          LEFT JOIN athletes a ON u.id = a.user_id AND u.user_type = 'athlete'
          WHERE u.id != ?
        `;

        const params = [currentUserId];

        // Add user type filter if specified
        if (userType && ['athlete', 'scout'].includes(userType)) {
          searchQuery += ' AND u.user_type = ?';
          params.push(userType);
        }

        // Add search filters
        searchQuery += ` AND (
          u.full_name LIKE ? 
          OR s.organization LIKE ?
          OR a.sport LIKE ?
          OR a.position LIKE ?
          OR a.country LIKE ?
        )`;

        const searchTerm = `%${query}%`;
        params.push(searchTerm, searchTerm, searchTerm, searchTerm, searchTerm);

        searchQuery += ' LIMIT 10';

        const [users] = await pool.query(searchQuery, params);

        const formattedUsers = users.map(user => ({
          id: user.id,
          name: user.user_type === 'scout' ? user.scout_organization : user.full_name,
          userType: user.user_type,
          sport: user.athlete_sport,
          position: user.athlete_position,
          country: user.athlete_country,
          scoutType: user.scout_type,
          profilePic: `/images/profiles/${user.id}.jpg`
        }));

        res.json(formattedUsers);
      } catch (error) {
        console.error('Error searching users:', error);
        res.status(500).json({ error: 'Failed to search users' });
      }
    });

    // Get unread message count
    app.get('/api/messages/unread-count', authenticate, async (req, res) => {
      try {
        const userId = req.user.id;

        const [result] = await pool.query(`
          SELECT COUNT(*) as unread_count
          FROM conversations
          WHERE receiver_id = ? AND is_read = FALSE
        `, [userId]);

        res.json({ unreadCount: result[0].unread_count });
      } catch (error) {
        console.error('Error fetching unread count:', error);
        res.status(500).json({ error: 'Failed to fetch unread count' });
      }
    });

    // Delete a message
    app.delete('/api/messages/:messageId', authenticate, async (req, res) => {
      try {
        const messageId = parseInt(req.params.messageId);
        const userId = req.user.id;

        // Verify the user owns this message
        const [message] = await pool.query(
          'SELECT sender_id FROM conversations WHERE id = ?',
          [messageId]
        );

        if (!message.length) {
          return res.status(404).json({ error: 'Message not found' });
        }

        if (message[0].sender_id !== userId) {
          return res.status(403).json({ error: 'Unauthorized to delete this message' });
        }

        await pool.query('DELETE FROM conversations WHERE id = ?', [messageId]);

        res.json({ message: 'Message deleted successfully' });
      } catch (error) {
        console.error('Error deleting message:', error);
        res.status(500).json({ error: 'Failed to delete message' });
      }
    });

    // Mark messages as read
    app.put('/api/conversations/:userId/mark-read', authenticate, async (req, res) => {
      try {
        const currentUserId = req.user.id;
        const otherUserId = parseInt(req.params.userId);

        await pool.query(`
          UPDATE conversations 
          SET is_read = TRUE 
          WHERE sender_id = ? AND receiver_id = ?
        `, [otherUserId, currentUserId]);

        res.json({ message: 'Messages marked as read' });
      } catch (error) {
        console.error('Error marking messages as read:', error);
        res.status(500).json({ error: 'Failed to mark messages as read' });
      }
    });

    // Add these endpoints to your server.js file

    // Get all notifications for a user with filtering
    app.get('/api/notifications', authenticate, async (req, res) => {
      try {
        const userId = req.user.id;
        const { type, unread_only, page = 1, limit = 20 } = req.query;
        const offset = (page - 1) * limit;

        let query = `
      SELECT 
        n.id,
        n.type,
        n.title,
        n.content,
        n.is_read,
        n.created_at,
        n.related_item_id,
        n.related_item_type,
        u.id as related_user_id,
        u.full_name as related_user_name,
        u.user_type as related_user_type,
        s.organization as scout_organization,
        a.sport as athlete_sport
      FROM notifications n
      LEFT JOIN users u ON n.related_user_id = u.id
      LEFT JOIN scouts s ON u.id = s.user_id AND u.user_type = 'scout'
      LEFT JOIN athletes a ON u.id = a.user_id AND u.user_type = 'athlete'
      WHERE n.user_id = ?
    `;

        const params = [userId];

        // Add type filter
        if (type && ['message', 'application', 'scout_interest', 'event', 'reaction', 'connection'].includes(type)) {
          query += ' AND n.type = ?';
          params.push(type);
        }

        // Add unread filter
        if (unread_only === 'true') {
          query += ' AND n.is_read = FALSE';
        }

        query += ' ORDER BY n.created_at DESC LIMIT ? OFFSET ?';
        params.push(parseInt(limit), offset);

        const [notifications] = await pool.query(query, params);

        const formattedNotifications = notifications.map(notification => ({
          id: notification.id,
          type: notification.type,
          title: notification.title,
          content: notification.content,
          isRead: notification.is_read,
          timestamp: formatTimeAgo(new Date(notification.created_at)),
          relatedUser: notification.related_user_id ? {
            id: notification.related_user_id,
            name: notification.related_user_type === 'scout'
              ? notification.scout_organization
              : notification.related_user_name,
            type: notification.related_user_type,
            profilePic: `/images/profiles/${notification.related_user_id}.jpg`
          } : null,
          icon: getNotificationIcon(notification.type),
          iconColor: getNotificationIconColor(notification.type)
        }));

        // Get total count for pagination
        let countQuery = 'SELECT COUNT(*) as total FROM notifications WHERE user_id = ?';
        let countParams = [userId];

        if (type && ['message', 'application', 'scout_interest', 'event', 'reaction', 'connection'].includes(type)) {
          countQuery += ' AND type = ?';
          countParams.push(type);
        }

        if (unread_only === 'true') {
          countQuery += ' AND is_read = FALSE';
        }

        const [countResult] = await pool.query(countQuery, countParams);
        const total = countResult[0].total;

        res.json({
          notifications: formattedNotifications,
          pagination: {
            currentPage: parseInt(page),
            totalPages: Math.ceil(total / limit),
            totalItems: total,
            hasMore: offset + notifications.length < total
          }
        });
      } catch (error) {
        console.error('Error fetching notifications:', error);
        res.status(500).json({ error: 'Failed to fetch notifications' });
      }
    });

    // Get notification counts by type
    app.get('/api/notifications/counts', authenticate, async (req, res) => {
      try {
        const userId = req.user.id;

        const [counts] = await pool.query(`
      SELECT 
        type,
        COUNT(*) as total_count,
        SUM(CASE WHEN is_read = FALSE THEN 1 ELSE 0 END) as unread_count
      FROM notifications 
      WHERE user_id = ? 
      GROUP BY type
    `, [userId]);

        const [totalCounts] = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN is_read = FALSE THEN 1 ELSE 0 END) as unread_count
      FROM notifications 
      WHERE user_id = ?
    `, [userId]);

        const typeCounts = {};
        counts.forEach(count => {
          typeCounts[count.type] = {
            total: count.total_count,
            unread: count.unread_count
          };
        });

        res.json({
          total: {
            total: totalCounts[0].total_count,
            unread: totalCounts[0].unread_count
          },
          byType: typeCounts
        });
      } catch (error) {
        console.error('Error fetching notification counts:', error);
        res.status(500).json({ error: 'Failed to fetch notification counts' });
      }
    });

    // Mark notification as read
    app.put('/api/notifications/:id/read', authenticate, async (req, res) => {
      try {
        const notificationId = parseInt(req.params.id);
        const userId = req.user.id;

        // Verify the notification belongs to the user
        const [notification] = await pool.query(
          'SELECT user_id FROM notifications WHERE id = ?',
          [notificationId]
        );

        if (!notification.length) {
          return res.status(404).json({ error: 'Notification not found' });
        }

        if (notification[0].user_id !== userId) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        await pool.query(
          'UPDATE notifications SET is_read = TRUE WHERE id = ?',
          [notificationId]
        );

        res.json({ message: 'Notification marked as read' });
      } catch (error) {
        console.error('Error marking notification as read:', error);
        res.status(500).json({ error: 'Failed to mark notification as read' });
      }
    });

    // Mark all notifications as read
    app.put('/api/notifications/mark-all-read', authenticate, async (req, res) => {
      try {
        const userId = req.user.id;
        const { type } = req.body;

        let query = 'UPDATE notifications SET is_read = TRUE WHERE user_id = ?';
        const params = [userId];

        if (type && ['message', 'application', 'scout_interest', 'event', 'reaction', 'connection'].includes(type)) {
          query += ' AND type = ?';
          params.push(type);
        }

        await pool.query(query, params);

        res.json({ message: 'Notifications marked as read' });
      } catch (error) {
        console.error('Error marking notifications as read:', error);
        res.status(500).json({ error: 'Failed to mark notifications as read' });
      }
    });

    // Delete notification
    app.delete('/api/notifications/:id', authenticate, async (req, res) => {
      try {
        const notificationId = parseInt(req.params.id);
        const userId = req.user.id;

        // Verify the notification belongs to the user
        const [notification] = await pool.query(
          'SELECT user_id FROM notifications WHERE id = ?',
          [notificationId]
        );

        if (!notification.length) {
          return res.status(404).json({ error: 'Notification not found' });
        }

        if (notification[0].user_id !== userId) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        await pool.query('DELETE FROM notifications WHERE id = ?', [notificationId]);

        res.json({ message: 'Notification deleted' });
      } catch (error) {
        console.error('Error deleting notification:', error);
        res.status(500).json({ error: 'Failed to delete notification' });
      }
    });

    // Create manual notification (for testing or special cases)
    app.post('/api/notifications', authenticate, async (req, res) => {
      try {
        const { user_id, type, title, content, related_user_id, related_item_id, related_item_type } = req.body;

        // Only admins or the user themselves can create notifications
        if (req.user.user_type !== 'admin' && req.user.id !== user_id) {
          return res.status(403).json({ error: 'Unauthorized' });
        }

        const [result] = await pool.query(`
      INSERT INTO notifications (user_id, type, title, content, related_user_id, related_item_id, related_item_type)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `, [user_id, type, title, content, related_user_id || null, related_item_id || null, related_item_type || null]);

        res.status(201).json({
          message: 'Notification created successfully',
          notificationId: result.insertId
        });
      } catch (error) {
        console.error('Error creating notification:', error);
        res.status(500).json({ error: 'Failed to create notification' });
      }
    });

    // Helper functions
    function formatTimeAgo(date) {
      const now = new Date();
      const diffInSeconds = Math.floor((now - date) / 1000);

      if (diffInSeconds < 60) {
        return `${diffInSeconds}s ago`;
      } else if (diffInSeconds < 3600) {
        const minutes = Math.floor(diffInSeconds / 60);
        return `${minutes}m ago`;
      } else if (diffInSeconds < 86400) {
        const hours = Math.floor(diffInSeconds / 3600);
        return `${hours}h ago`;
      } else if (diffInSeconds < 2592000) {
        const days = Math.floor(diffInSeconds / 86400);
        return `${days}d ago`;
      } else {
        return date.toLocaleDateString();
      }
    }

    function getNotificationIcon(type) {
      const icons = {
        'message': 'bx-envelope',
        'application': 'bx-check',
        'scout_interest': 'bx-star',
        'event': 'bx-calendar',
        'reaction': 'bx-like',
        'connection': 'bx-user-plus'
      };
      return icons[type] || 'bx-bell';
    }

    function getNotificationIconColor(type) {
      const colors = {
        'message': 'bg-blue-500',
        'application': 'bg-green-500',
        'scout_interest': 'bg-yellow-500',
        'event': 'bg-purple-500',
        'reaction': 'bg-red-500',
        'connection': 'bg-blue-500'
      };
      return colors[type] || 'bg-gray-500';
    }

    // Get scout requests
    app.get('/api/scout-requests', authenticate, async (req, res) => {
      try {
        // Only athletes can have scout requests
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const [requests] = await pool.query(`
      SELECT 
        sr.id,
        sr.status,
        sr.created_at,
        u.id as scout_id,
        u.full_name as scout_name,
        s.organization,
        s.scout_type
      FROM scout_requests sr
      JOIN users u ON sr.scout_id = u.id
      JOIN scouts s ON u.id = s.user_id
      WHERE sr.athlete_id = ? AND sr.status = 'pending'
      ORDER BY sr.created_at DESC
      LIMIT 5
    `, [req.user.id]);

        const formattedRequests = requests.map(request => ({
          id: request.id,
          status: request.status,
          timestamp: new Date(request.created_at).toLocaleDateString(),
          scout: {
            id: request.scout_id,
            name: request.scout_name,
            organization: request.organization,
            scout_type: request.scout_type,
            profile_pic: `/images/profiles/${request.scout_id}.jpg`
          }
        }));

        res.json(formattedRequests);
      } catch (error) {
        console.error('Error fetching scout requests:', error);
        res.status(500).json({ error: 'Failed to fetch scout requests' });
      }
    });

    // Get online scouts
    app.get('/api/online-scouts', authenticate, async (req, res) => {
      try {
        // For demo purposes, we'll return some random scouts
        const [scouts] = await pool.query(`
      SELECT 
        u.id,
        u.full_name,
        s.organization,
        s.scout_type,
        s.country,
        MAX(sr.created_at) as last_interaction
      FROM scouts s
      JOIN users u ON s.user_id = u.id
      LEFT JOIN scout_requests sr ON s.user_id = sr.scout_id AND sr.athlete_id = ?
      WHERE u.id IN (
        SELECT scout_id FROM athlete_scout_connections WHERE athlete_id = ?
      )
      GROUP BY u.id
      ORDER BY last_interaction DESC
      LIMIT 5
    `, [req.user.id, req.user.id]);

        const formattedScouts = scouts.map(scout => ({
          id: scout.id,
          name: scout.full_name,
          organization: scout.organization,
          scout_type: scout.scout_type,
          country: scout.country,
          profile_pic: `/images/profiles/${scout.id}.jpg`,
          online: true // For demo, all are online
        }));

        res.json(formattedScouts);
      } catch (error) {
        console.error('Error fetching online scouts:', error);
        res.status(500).json({ error: 'Failed to fetch online scouts' });
      }
    });

    // Get performance metrics
    app.get('/api/performance-metrics', authenticate, async (req, res) => {
      try {
        // Only athletes have performance metrics
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const [metrics] = await pool.query(`
      SELECT 
        stat_name as name,
        stat_value as value,
        recorded_at
      FROM athlete_stats
      WHERE athlete_id = ?
      ORDER BY recorded_at DESC
      LIMIT 5
    `, [req.user.id]);

        // For demo, we'll add some trend data
        const formattedMetrics = metrics.map((metric, index) => {
          const value = parseFloat(metric.value.replace(/[^\d.]/g, ''));
          const trend = index % 3 === 0 ? 'up' : index % 3 === 1 ? 'down' : 'same';
          const change = trend === 'same' ? 0 : (5 + Math.random() * 10) * (trend === 'up' ? 1 : -1);

          return {
            name: metric.name,
            value: metric.value,
            percentage: Math.min(100, Math.max(10, (value / (index + 1)) * 10)), // Fake percentage for demo
            trend,
            change: trend === 'same' ? null : change.toFixed(1)
          };
        });

        res.json(formattedMetrics);
      } catch (error) {
        console.error('Error fetching performance metrics:', error);
        res.status(500).json({ error: 'Failed to fetch performance metrics' });
      }
    });

    // Add athlete stats
    app.post('/api/stats', authenticate, async (req, res) => {
      try {
        // Only athletes can add stats
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const { name, value, update_existing } = req.body;

        if (update_existing) {
          // Update existing stat if it exists
          const [existing] = await pool.query(
            'SELECT * FROM athlete_stats WHERE athlete_id = ? AND stat_name = ?',
            [req.user.id, name]
          );

          if (existing.length) {
            // Update existing record
            await pool.query(
              'UPDATE athlete_stats SET stat_value = ? WHERE id = ?',
              [value, existing[0].id]
            );
          } else {
            // Insert new record
            await pool.query(
              'INSERT INTO athlete_stats (athlete_id, stat_name, stat_value) VALUES (?, ?, ?)',
              [req.user.id, name, value]
            );
          }
        } else {
          // Always insert new record (default behavior)
          await pool.query(
            'INSERT INTO athlete_stats (athlete_id, stat_name, stat_value) VALUES (?, ?, ?)',
            [req.user.id, name, value]
          );
        }

        // Return the updated stats list
        const [stats] = await pool.query(
          'SELECT * FROM athlete_stats WHERE athlete_id = ? ORDER BY recorded_at DESC',
          [req.user.id]
        );

        res.json({
          message: 'Stat saved successfully',
          stats
        });
      } catch (error) {
        console.error('Error adding stat:', error);
        res.status(500).json({ error: 'Failed to add stat' });
      }
    });

    // Upload athlete video
    app.post('/api/videos', authenticate, async (req, res) => {
      try {
        // Only athletes can upload videos
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const { title, description } = req.body;
        const videoUrl = `/uploads/videos/${Date.now()}_${req.files.video.name}`;

        await pool.query(
          'INSERT INTO athlete_videos (athlete_id, title, description, url) VALUES (?, ?, ?, ?)',
          [req.user.id, title, description, videoUrl]
        );

        // Create a post about the new video
        await pool.query(
          'INSERT INTO posts (user_id, content, media_url, media_type) VALUES (?, ?, ?, ?)',
          [req.user.id, `I've uploaded a new training video: ${title}`, videoUrl, 'video']
        );

        res.json({ message: 'Video uploaded successfully' });
      } catch (error) {
        console.error('Error uploading video:', error);
        res.status(500).json({ error: 'Failed to upload video' });
      }
    });

    // Add athlete achievement
    app.post('/api/achievements', authenticate, async (req, res) => {
      try {
        // Only athletes can add achievements
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const { title, description, date } = req.body;
        const imageUrl = req.files.image ? `/uploads/achievements/${Date.now()}_${req.files.image.name}` : null;

        await pool.query(
          'INSERT INTO athlete_achievements (athlete_id, title, description, date, image_url) VALUES (?, ?, ?, ?, ?)',
          [req.user.id, title, description, date, imageUrl]
        );

        // Create a post about the new achievement
        await pool.query(
          'INSERT INTO posts (user_id, content, media_url, media_type) VALUES (?, ?, ?, ?)',
          [req.user.id, `I've achieved: ${title}`, imageUrl, 'image']
        );

        res.json({ message: 'Achievement added successfully' });
      } catch (error) {
        console.error('Error adding achievement:', error);
        res.status(500).json({ error: 'Failed to add achievement' });
      }
    });

    // Get upcoming events for athlete
    app.get('/api/athlete/events/upcoming', authenticate, async (req, res) => {
      try {
        // Only athletes can access this endpoint
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const [events] = await pool.query(`
      SELECT 
        e.id,
        e.title,
        e.description,
        e.event_type as type,
        e.location,
        e.start_date as date,
        s.organization
      FROM events e
      JOIN scouts s ON e.organizer_id = s.user_id
      JOIN athlete_scout_connections asc ON s.user_id = asc.scout_id
      WHERE asc.athlete_id = ?
      AND e.start_date > NOW()
      ORDER BY e.start_date ASC
      LIMIT 5
    `, [req.user.id]);

        res.json(events);
      } catch (error) {
        console.error('Error fetching upcoming events:', error);
        res.status(500).json({ error: 'Failed to fetch upcoming events' });
      }
    });

    // Get scouting interest metrics
    app.get('/api/profile/scouting-interest', authenticate, async (req, res) => {
      try {
        // Only athletes can access this endpoint
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        // Get profile views
        const [views] = await pool.query(`
      SELECT COUNT(*) as count FROM profile_views 
      WHERE athlete_id = ?
    `, [req.user.id]);

        // Get shortlists count
        const [shortlists] = await pool.query(`
      SELECT COUNT(*) as count FROM shortlists 
      WHERE athlete_id = ?
    `, [req.user.id]);

        // Get messages count
        const [messages] = await pool.query(`
      SELECT COUNT(*) as count FROM messages 
      WHERE receiver_id = ? AND sender_type = 'scout'
    `, [req.user.id]);

        // Get tryout invites
        const [invites] = await pool.query(`
      SELECT COUNT(*) as count FROM event_invites 
      WHERE athlete_id = ? AND event_type = 'tryout'
    `, [req.user.id]);

        res.json({
          views: views[0].count,
          shortlists: shortlists[0].count,
          messages: messages[0].count,
          invites: invites[0].count
        });
      } catch (error) {
        console.error('Error fetching scouting interest:', error);
        res.status(500).json({ error: 'Failed to fetch scouting interest' });
      }
    });

    // Get upcoming events for athlete
    app.get('/api/athlete/events/upcoming', authenticate, async (req, res) => {
      try {
        // Only athletes can access this endpoint
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        const [events] = await pool.query(`
            SELECT 
                e.id,
                e.title,
                e.description,
                e.event_type as type,
                e.location,
                e.start_date as date,
                s.organization
            FROM events e
            JOIN scouts s ON e.organizer_id = s.user_id
            JOIN athlete_scout_connections asc ON s.user_id = asc.scout_id
            WHERE asc.athlete_id = ?
            AND e.start_date > NOW()
            ORDER BY e.start_date ASC
            LIMIT 5
        `, [req.user.id]);

        res.json(events);
      } catch (error) {
        console.error('Error fetching upcoming events:', error);
        res.status(500).json({ error: 'Failed to fetch upcoming events' });
      }
    });

    // Get scouting interest metrics
    app.get('/api/profile/scouting-interest', authenticate, async (req, res) => {
      try {
        // Only athletes can access this endpoint
        if (req.user.user_type !== 'athlete') {
          return res.status(403).json({ error: 'Access denied' });
        }

        // Get profile views (mock data since we don't have this table)
        const views = { count: Math.floor(Math.random() * 100) + 10 };

        // Get shortlists count
        const [shortlists] = await pool.query(`
            SELECT COUNT(*) as count FROM shortlists 
            WHERE athlete_id = ?
        `, [req.user.id]);

        // Get messages count (mock data since we don't have this table)
        const messages = { count: Math.floor(Math.random() * 20) };

        // Get tryout invites (mock data since we don't have this table)
        const invites = { count: Math.floor(Math.random() * 5) };

        res.json({
          views: views.count,
          shortlists: shortlists[0].count,
          messages: messages.count,
          invites: invites.count
        });
      } catch (error) {
        console.error('Error fetching scouting interest:', error);
        res.status(500).json({ error: 'Failed to fetch scouting interest' });
      }
    });

    // Start the server
    app.listen(PORT, () => {
      console.log(`Server running on port ${PORT}`);
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();