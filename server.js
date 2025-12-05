// server.js

const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const app = express();
const port = 3000;
const DB_PATH = path.join(__dirname, 'task_manager.db');

// --- Middleware Setup ---
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));
app.use(express.urlencoded({ extended: true })); // Middleware to parse form data

// --- Database Connection ---
let db = new sqlite3.Database(DB_PATH, sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE, (err) => {
    if (err) {
        console.error('Error opening database:', err.message);
    } else {
        console.log('Connected to the SQLite database.');
        initDb(); // Initialize tables and static users
    }
});

// --- Database Initialization ---
function initDb() {
    // 1. Create User table
    db.run(`CREATE TABLE IF NOT EXISTS user (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL
    )`);

    // 2. Create Task table (UPDATED to include priority)
    db.run(`CREATE TABLE IF NOT EXISTS task (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        title TEXT NOT NULL,
        assigned_user_id INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'Open',
        priority TEXT NOT NULL DEFAULT 'Medium', 
        created_at TEXT NOT NULL DEFAULT (DATETIME('now')), 
        FOREIGN KEY (assigned_user_id) REFERENCES user(id)
    )`);

    // 3. Insert static users ('Alice', 'Bob') if they don't exist
    const staticUsers = ['Alice', 'Bob'];
    staticUsers.forEach(username => {
        db.run(`INSERT OR IGNORE INTO user (username) VALUES (?)`, [username], (err) => {
            if (err) {
                // IGNORE clause prevents error if user already exists
            }
        });
    });
}

// --- Application Routes ---

// GET Route: Display all tasks and the task creation form, now with filtering and sorting
app.get('/', (req, res) => {
    // 1. Get filter parameters from the URL query string
    const filterUserId = req.query.user_id;
    const filterStatus = req.query.status;
    const filterPriority = req.query.priority; // NEW FILTER
    
    // 2. Start building the SQL query and parameters
    let sql = `
        SELECT 
            t.id, t.title, t.status, u.username,
            t.created_at,
            t.priority  
        FROM task t
        JOIN user u ON t.assigned_user_id = u.id
    `;
    let params = [];
    let whereClauses = [];

    // 3. Conditionally add WHERE clauses based on filters
    if (filterUserId && filterUserId !== 'all') {
        whereClauses.push("t.assigned_user_id = ?");
        params.push(filterUserId);
    }

    if (filterStatus && filterStatus !== 'all') {
        whereClauses.push("t.status = ?");
        params.push(filterStatus);
    }

    if (filterPriority && filterPriority !== 'all') {
        whereClauses.push("t.priority = ?");
        params.push(filterPriority);
    }

    // Combine WHERE clauses if any exist
    if (whereClauses.length > 0) {
        sql += " WHERE " + whereClauses.join(" AND ");
    }

    // 4. Add sorting (High Priority First, then by newest ID)
    sql += " ORDER BY CASE t.priority WHEN 'High' THEN 1 WHEN 'Medium' THEN 2 WHEN 'Low' THEN 3 ELSE 4 END, t.id DESC"; 

    db.all(sql, params, (err, tasks) => {
        if (err) {
            return res.status(500).send("Database error fetching tasks: " + err.message);
        }

        // Fetch all users for the assignment and filter dropdowns
        db.all("SELECT id, username FROM user ORDER BY username ASC", [], (err, users) => {
            if (err) {
                return res.status(500).send("Database error fetching users: " + err.message);
            }
            
            // Render the template, passing tasks, users, and the current filter values
            res.render('index', { 
                tasks: tasks, 
                users: users,
                currentUserId: filterUserId,
                currentStatus: filterStatus,
                currentPriority: filterPriority
            });
        });
    });
});

// POST Route: Handle new task submission (UPDATED)
app.post('/', (req, res) => {
    const { title, user_id, priority } = req.body;
    
    if (!title || !user_id || !priority) {
        return res.redirect('/'); 
    }

    db.run(`INSERT INTO task (title, assigned_user_id, priority) VALUES (?, ?, ?)`, 
        [title, user_id, priority], 
        function(err) {
            if (err) {
                return res.status(500).send("Database error inserting task: " + err.message);
            }
            res.redirect('/'); 
        }
    );
});

// GET Route: Mark a task as complete
app.get('/complete/:id', (req, res) => {
    const taskId = req.params.id;
    db.run(`UPDATE task SET status = 'Complete' WHERE id = ?`, [taskId], function(err) {
        if (err) {
            return res.status(500).send("Database error updating task status: " + err.message);
        }
        res.redirect('/');
    });
});

// GET Route: Delete a task
app.get('/delete/:id', (req, res) => {
    const taskId = req.params.id;
    db.run(`DELETE FROM task WHERE id = ?`, [taskId], function(err) {
        if (err) {
            return res.status(500).send("Database error deleting task: " + err.message);
        }
        res.redirect('/');
    });
});

// GET Route: Display the edit form for a specific task (FIXED and UPDATED)
app.get('/edit/:id', (req, res) => {
    const taskId = req.params.id;
    
    // 1. Fetch the specific task data, including created_at and priority
    const taskSql = `
        SELECT 
            t.id, t.title, t.status, t.assigned_user_id, u.username,
            t.created_at, t.priority 
        FROM task t
        JOIN user u ON t.assigned_user_id = u.id
        WHERE t.id = ?
    `;

    db.get(taskSql, [taskId], (err, task) => {
        if (err || !task) {
            console.error('Error fetching task for edit:', err ? err.message : 'Task not found');
            return res.redirect('/');
        }
        
        // 2. Fetch all users for the assignment dropdown
        db.all("SELECT id, username FROM user ORDER BY username ASC", [], (err, users) => {
            if (err) {
                return res.status(500).send("Database error fetching users: " + err.message);
            }
            
            // 3. Render the edit template
            res.render('edit', { task: task, users: users });
        });
    });
});

// POST Route: Handle the submission of the updated task form (UPDATED)
app.post('/edit/:id', (req, res) => {
    const taskId = req.params.id;
    const { title, user_id, priority } = req.body;
    
    if (!title || !user_id || !priority) {
        return res.redirect('/edit/' + taskId); 
    }

    // Update the task in the database
    db.run(
        `UPDATE task SET title = ?, assigned_user_id = ?, priority = ? WHERE id = ?`, 
        [title, user_id, priority, taskId], 
        function(err) {
            if (err) {
                return res.status(500).send("Database error updating task: " + err.message);
            }
            res.redirect('/'); 
        }
    );
});

// --- User Management Routes ---

// GET Route: Display all users and the user creation form
app.get('/users', (req, res) => {
    db.all("SELECT id, username FROM user ORDER BY id ASC", [], (err, users) => {
        if (err) {
            return res.status(500).send("Database error fetching users: " + err.message);
        }
        res.render('users', { users: users });
    });
});

// POST Route: Handle new user submission
app.post('/users', (req, res) => {
    const { username } = req.body;
    
    if (!username) {
        return res.redirect('/users');
    }

    db.run(`INSERT OR IGNORE INTO user (username) VALUES (?)`, 
        [username], 
        function(err) {
            if (err) {
                console.error("User insertion failed:", err.message);
                return res.status(500).send("Database error inserting user: " + err.message);
            }
            res.redirect('/users'); 
        }
    );
});

// GET Route: Delete a user
app.get('/delete-user/:id', (req, res) => {
    const userId = req.params.id;
    db.run(`DELETE FROM user WHERE id = ?`, [userId], function(err) {
        if (err) {
            console.error("User deletion failed, check for assigned tasks:", err.message);
            return res.redirect('/users'); 
        }
        res.redirect('/users');
    });
});

// --- Start the Server ---
app.listen(port, () => {
    console.log(`Task Manager running at http://localhost:${port}`);
});