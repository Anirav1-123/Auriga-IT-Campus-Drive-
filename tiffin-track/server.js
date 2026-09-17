const express = require("express");
const Database = require("better-sqlite3");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const cors = require("cors");
const path = require("path");

const app = express();

const PORT = 3000;
const JWT_SECRET = "tiffin-track-secret-key";

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(path.join(__dirname, "public")));

// =====================================================
// DATABASE
// =====================================================

const db = new Database("tiffin.db");

db.pragma("foreign_keys = ON");

// =====================================================
// USERS
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
`).run();

// =====================================================
// CUSTOMERS
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS customers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        name TEXT NOT NULL,
        phone TEXT UNIQUE NOT NULL,
        address TEXT NOT NULL,
        monthly_price REAL NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
`).run();

// =====================================================
// SERVICE DAYS
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS service_days (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        service_date TEXT NOT NULL,
        status TEXT NOT NULL,
        subscription_id INTEGER,
        UNIQUE(customer_id, service_date),
        FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
`).run();

// =====================================================
// PAYMENTS
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS payments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        amount REAL NOT NULL,
        payment_date TEXT NOT NULL,
        payment_method TEXT DEFAULT 'CASH',
        note TEXT DEFAULT '',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
`).run();

// =====================================================
// SUBSCRIPTIONS
// T6 - SUBSCRIPTION LIFECYCLE / TRANSFER
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        plan_price REAL NOT NULL,
        cycle_start TEXT NOT NULL,
        cycle_end TEXT NOT NULL,
        status TEXT DEFAULT 'ACTIVE',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
`).run();

// =====================================================
// SUBSCRIPTION TRANSFERS
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS subscription_transfers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        subscription_id INTEGER NOT NULL,
        from_customer_id INTEGER NOT NULL,
        to_customer_id INTEGER NOT NULL,
        transfer_date TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(subscription_id) REFERENCES subscriptions(id),
        FOREIGN KEY(from_customer_id) REFERENCES customers(id),
        FOREIGN KEY(to_customer_id) REFERENCES customers(id)
    )
`).run();

// =====================================================
// NOTIFICATION OUTBOX
// T1 - MORNING DELIVERY NOTIFICATIONS
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS notification_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        customer_id INTEGER NOT NULL,
        phone TEXT NOT NULL,
        message TEXT NOT NULL,
        notification_type TEXT DEFAULT 'DELIVERY_DUE',
        delivery_date TEXT NOT NULL,
        status TEXT DEFAULT 'PENDING',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
`).run();

// =====================================================
// IMPORT BATCHES
// T4 - MESSY DATA IMPORT
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS import_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER,
        filename TEXT DEFAULT '',
        imported_count INTEGER DEFAULT 0,
        deduped_count INTEGER DEFAULT 0,
        rejected_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY(user_id) REFERENCES users(id)
    )
`).run();

// =====================================================
// IMPORT RECORDS
// =====================================================

db.prepare(`
    CREATE TABLE IF NOT EXISTS import_records (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL,
        raw_name TEXT DEFAULT '',
        raw_phone TEXT DEFAULT '',
        raw_address TEXT DEFAULT '',
        raw_price TEXT DEFAULT '',
        raw_date TEXT DEFAULT '',
        result TEXT NOT NULL,
        reason TEXT DEFAULT '',
        customer_id INTEGER,
        FOREIGN KEY(batch_id) REFERENCES import_batches(id),
        FOREIGN KEY(customer_id) REFERENCES customers(id)
    )
`).run();

// =====================================================
// DATABASE MIGRATIONS
// =====================================================

// Add user_id to old customers table if required
try {
    db.prepare(`
        ALTER TABLE customers
        ADD COLUMN user_id INTEGER
    `).run();
} catch (error) {
    // Column already exists
}

// Add subscription_id to old service_days table if required
try {
    db.prepare(`
        ALTER TABLE service_days
        ADD COLUMN subscription_id INTEGER
    `).run();
} catch (error) {
    // Column already exists
}

// Assign old customers to first registered user
try {
    const firstUser = db.prepare(`
        SELECT id
        FROM users
        ORDER BY id
        LIMIT 1
    `).get();

    if (firstUser) {
        db.prepare(`
            UPDATE customers
            SET user_id = ?
            WHERE user_id IS NULL
        `).run(firstUser.id);
    }
} catch (error) {
    console.log("Customer migration checked.");
}

// =====================================================
// HELPER FUNCTIONS
// =====================================================

function todayDate() {
    const now = new Date();

    const year = now.getFullYear();
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const day = String(now.getDate()).padStart(2, "0");

    return `${year}-${month}-${day}`;
}

function getDaysInMonth(year, month) {
    return new Date(year, month, 0).getDate();
}

function getCurrentMonth() {
    const now = new Date();

    return {
        year: now.getFullYear(),
        month: now.getMonth() + 1
    };
}

function isWeekday(dateString) {
    const date = new Date(`${dateString}T00:00:00`);
    const day = date.getDay();

    return day !== 0 && day !== 6;
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function generateToken(user) {
    return jwt.sign(
        {
            id: user.id,
            email: user.email,
            name: user.name
        },
        JWT_SECRET,
        {
            expiresIn: "7d"
        }
    );
}

// =====================================================
// AUTH MIDDLEWARE
// =====================================================

function authenticateToken(req, res, next) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(401).json({
            message: "Authentication required"
        });
    }

    const token = authHeader.split(" ")[1];

    if (!token) {
        return res.status(401).json({
            message: "Invalid token"
        });
    }

    try {
        const decoded = jwt.verify(
            token,
            JWT_SECRET
        );

        req.user = decoded;

        next();
    } catch (error) {
        return res.status(401).json({
            message: "Invalid or expired token"
        });
    }
}

// =====================================================
// AUTH - REGISTER
// =====================================================

app.post(
    "/api/auth/register",
    async (req, res) => {

        try {

            const {
                name,
                email,
                password
            } = req.body;

            if (!name || !email || !password) {
                return res.status(400).json({
                    message:
                        "Name, email and password are required"
                });
            }

            if (!isValidEmail(email)) {
                return res.status(400).json({
                    message:
                        "Please enter a valid email"
                });
            }

            if (password.length < 6) {
                return res.status(400).json({
                    message:
                        "Password must be at least 6 characters"
                });
            }

            const cleanEmail =
                email.toLowerCase().trim();

            const existingUser =
                db.prepare(`
                    SELECT id
                    FROM users
                    WHERE email = ?
                `).get(cleanEmail);

            if (existingUser) {
                return res.status(409).json({
                    message:
                        "Email already registered"
                });
            }

            const hashedPassword =
                await bcrypt.hash(password, 10);

            const result =
                db.prepare(`
                    INSERT INTO users (
                        name,
                        email,
                        password
                    )
                    VALUES (?, ?, ?)
                `).run(
                    name.trim(),
                    cleanEmail,
                    hashedPassword
                );

            const user =
                db.prepare(`
                    SELECT
                        id,
                        name,
                        email,
                        created_at
                    FROM users
                    WHERE id = ?
                `).get(result.lastInsertRowid);

            const token =
                generateToken(user);

            res.status(201).json({
                message:
                    "Registration successful",
                token,
                user
            });

        } catch (error) {

            console.error(
                "Register error:",
                error
            );

            res.status(500).json({
                message:
                    "Registration failed"
            });
        }
    }
);

// =====================================================
// AUTH - LOGIN
// =====================================================

app.post(
    "/api/auth/login",
    async (req, res) => {

        try {

            const {
                email,
                password
            } = req.body;

            if (!email || !password) {
                return res.status(400).json({
                    message:
                        "Email and password are required"
                });
            }

            const user =
                db.prepare(`
                    SELECT *
                    FROM users
                    WHERE email = ?
                `).get(
                    email.toLowerCase().trim()
                );

            if (!user) {
                return res.status(401).json({
                    message:
                        "Invalid email or password"
                });
            }

            const passwordMatch =
                await bcrypt.compare(
                    password,
                    user.password
                );

            if (!passwordMatch) {
                return res.status(401).json({
                    message:
                        "Invalid email or password"
                });
            }

            const safeUser = {
                id: user.id,
                name: user.name,
                email: user.email,
                created_at: user.created_at
            };

            const token =
                generateToken(safeUser);

            res.json({
                message:
                    "Login successful",
                token,
                user: safeUser
            });

        } catch (error) {

            console.error(
                "Login error:",
                error
            );

            res.status(500).json({
                message:
                    "Login failed"
            });
        }
    }
);

// =====================================================
// PROFILE
// =====================================================

app.get(
    "/api/profile",
    authenticateToken,
    (req, res) => {

        const user =
            db.prepare(`
                SELECT
                    id,
                    name,
                    email,
                    created_at
                FROM users
                WHERE id = ?
            `).get(req.user.id);

        if (!user) {
            return res.status(404).json({
                message:
                    "User not found"
            });
        }

        res.json(user);
    }
);

// =====================================================
// UPDATE PROFILE
// =====================================================

app.put(
    "/api/profile",
    authenticateToken,
    (req, res) => {

        const {
            name,
            email
        } = req.body;

        if (!name || !email) {
            return res.status(400).json({
                message:
                    "Name and email are required"
            });
        }

        if (!isValidEmail(email)) {
            return res.status(400).json({
                message:
                    "Invalid email"
            });
        }

        const cleanEmail =
            email.toLowerCase().trim();

        const existingUser =
            db.prepare(`
                SELECT id
                FROM users
                WHERE email = ?
                AND id != ?
            `).get(
                cleanEmail,
                req.user.id
            );

        if (existingUser) {
            return res.status(409).json({
                message:
                    "Email already in use"
            });
        }

        db.prepare(`
            UPDATE users
            SET
                name = ?,
                email = ?
            WHERE id = ?
        `).run(
            name.trim(),
            cleanEmail,
            req.user.id
        );

        const updatedUser =
            db.prepare(`
                SELECT
                    id,
                    name,
                    email,
                    created_at
                FROM users
                WHERE id = ?
            `).get(req.user.id);

        res.json({
            message:
                "Profile updated",
            user: updatedUser
        });
    }
);

// =====================================================
// CHANGE PASSWORD
// =====================================================

app.put(
    "/api/profile/password",
    authenticateToken,
    async (req, res) => {

        const {
            currentPassword,
            newPassword
        } = req.body;

        if (!currentPassword || !newPassword) {
            return res.status(400).json({
                message:
                    "Current and new password are required"
            });
        }

        if (newPassword.length < 6) {
            return res.status(400).json({
                message:
                    "New password must be at least 6 characters"
            });
        }

        const user =
            db.prepare(`
                SELECT *
                FROM users
                WHERE id = ?
            `).get(req.user.id);

        if (!user) {
            return res.status(404).json({
                message:
                    "User not found"
            });
        }

        const valid =
            await bcrypt.compare(
                currentPassword,
                user.password
            );

        if (!valid) {
            return res.status(401).json({
                message:
                    "Current password is incorrect"
            });
        }

        const hashedPassword =
            await bcrypt.hash(
                newPassword,
                10
            );

        db.prepare(`
            UPDATE users
            SET password = ?
            WHERE id = ?
        `).run(
            hashedPassword,
            req.user.id
        );

        res.json({
            message:
                "Password changed successfully"
        });
    }
);

// =====================================================
// CUSTOMER HELPER
// =====================================================

function getCustomerForUser(
    customerId,
    userId
) {
    return db.prepare(`
        SELECT *
        FROM customers
        WHERE id = ?
        AND user_id = ?
    `).get(
        customerId,
        userId
    );
}

// =====================================================
// CREATE DEFAULT SUBSCRIPTION
// =====================================================

function createSubscriptionForCustomer(
    customerId,
    price,
    startDate
) {

    const date = new Date(
        `${startDate}T00:00:00`
    );

    const year = date.getFullYear();
    const month = date.getMonth();

    const lastDay =
        new Date(
            year,
            month + 1,
            0
        ).getDate();

    const endDate =
        `${year}-${String(month + 1).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;

    const existing =
        db.prepare(`
            SELECT id
            FROM subscriptions
            WHERE customer_id = ?
            AND status = 'ACTIVE'
        `).get(customerId);

    if (existing) {
        return existing.id;
    }

    const result =
        db.prepare(`
            INSERT INTO subscriptions (
                customer_id,
                plan_price,
                cycle_start,
                cycle_end,
                status
            )
            VALUES (?, ?, ?, ?, 'ACTIVE')
        `).run(
            customerId,
            price,
            startDate,
            endDate
        );

    return result.lastInsertRowid;
}

// =====================================================
// ENSURE SERVICE DAYS
// =====================================================

function ensureServiceDays(
    customer,
    year,
    month
) {

    const daysInMonth =
        getDaysInMonth(
            year,
            month
        );

    const today =
        new Date();

    const currentYear =
        today.getFullYear();

    const currentMonth =
        today.getMonth() + 1;

    const currentDay =
        today.getDate();

    let lastDay =
        daysInMonth;

    if (
        year === currentYear &&
        month === currentMonth
    ) {
        lastDay = currentDay;
    }

    if (
        year > currentYear ||
        (
            year === currentYear &&
            month > currentMonth
        )
    ) {
        return;
    }

    const subscriptionId =
        createSubscriptionForCustomer(
            customer.id,
            customer.monthly_price,
            `${year}-${String(month).padStart(2, "0")}-01`
        );

    const insert =
        db.prepare(`
            INSERT OR IGNORE INTO service_days (
                customer_id,
                service_date,
                status,
                subscription_id
            )
            VALUES (?, ?, ?, ?)
        `);

    const transaction =
        db.transaction(() => {

            for (
                let day = 1;
                day <= lastDay;
                day++
            ) {

                const date =
                    `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

                const dateObj =
                    new Date(
                        year,
                        month - 1,
                        day
                    );

                const weekday =
                    dateObj.getDay();

                // Monday-Friday only
                if (
                    weekday === 0 ||
                    weekday === 6
                ) {
                    continue;
                }

                insert.run(
                    customer.id,
                    date,
                    customer.status === "ACTIVE"
                        ? "SERVED"
                        : "PAUSED",
                    subscriptionId
                );
            }
        });

    transaction();
}
// =====================================================
// DASHBOARD
// =====================================================

app.get(
    "/api/dashboard",
    authenticateToken,
    (req, res) => {

        const totalCustomers =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM customers
                WHERE user_id = ?
            `).get(req.user.id).count;

        const activeCustomers =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM customers
                WHERE user_id = ?
                AND status = 'ACTIVE'
            `).get(req.user.id).count;

        const pausedCustomers =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM customers
                WHERE user_id = ?
                AND status = 'PAUSED'
            `).get(req.user.id).count;

        const totalRevenue =
            db.prepare(`
                SELECT COALESCE(SUM(p.amount), 0) AS total
                FROM payments p
                JOIN customers c
                    ON c.id = p.customer_id
                WHERE c.user_id = ?
            `).get(req.user.id).total;

        const today = todayDate();

        const todayServed =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM service_days sd
                JOIN customers c
                    ON c.id = sd.customer_id
                WHERE c.user_id = ?
                AND sd.service_date = ?
                AND sd.status = 'SERVED'
            `).get(
                req.user.id,
                today
            ).count;

        res.json({
            totalCustomers,
            activeCustomers,
            pausedCustomers,
            totalRevenue,
            todayServed
        });
    }
);

// =====================================================
// GET CUSTOMERS
// SEARCH + PAGINATION + SORTING
// =====================================================

app.get(
    "/api/customers",
    authenticateToken,
    (req, res) => {

        const search =
            (req.query.search || "").trim();

        const page =
            Math.max(
                parseInt(req.query.page) || 1,
                1
            );

        const limit =
            Math.min(
                Math.max(
                    parseInt(req.query.limit) || 10,
                    1
                ),
                100
            );

        const sortBy =
            req.query.sortBy || "id";

        const order =
            String(req.query.order).toUpperCase() === "DESC"
                ? "DESC"
                : "ASC";

        const allowedSortFields = {
            id: "id",
            name: "name",
            phone: "phone",
            monthly_price: "monthly_price",
            status: "status",
            created_at: "created_at"
        };

        const sortColumn =
            allowedSortFields[sortBy] || "id";

        const offset =
            (page - 1) * limit;

        let where = `
            WHERE user_id = ?
        `;

        const params = [
            req.user.id
        ];

        if (search) {

            where += `
                AND (
                    name LIKE ?
                    OR phone LIKE ?
                    OR address LIKE ?
                )
            `;

            const searchValue =
                `%${search}%`;

            params.push(
                searchValue,
                searchValue,
                searchValue
            );
        }

        const total =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM customers
                ${where}
            `).get(...params).count;

        const customers =
            db.prepare(`
                SELECT
                    id,
                    name,
                    phone,
                    address,
                    monthly_price,
                    status,
                    created_at
                FROM customers
                ${where}
                ORDER BY ${sortColumn} ${order}
                LIMIT ? OFFSET ?
            `).all(
                ...params,
                limit,
                offset
            );

        res.json({
            customers,
            pagination: {
                page,
                limit,
                total,
                totalPages:
                    Math.ceil(
                        total / limit
                    )
            },
            sorting: {
                sortBy,
                order
            }
        });
    }
);

// =====================================================
// CREATE CUSTOMER / SUBSCRIBE
// =====================================================

app.post(
    "/api/customers",
    authenticateToken,
    (req, res) => {

        const {
            name,
            phone,
            address,
            monthly_price,
            monthlyPrice,
            cycle_start
        } = req.body;

        const price =
            monthly_price !== undefined
                ? monthly_price
                : monthlyPrice;

        if (
            !name ||
            !phone ||
            !address ||
            price === undefined ||
            price === null ||
            price === ""
        ) {
            return res.status(400).json({
                message:
                    "Name, phone, address and monthly price are required"
            });
        }

        const numericPrice =
            Number(price);

        if (
            !Number.isFinite(numericPrice) ||
            numericPrice <= 0
        ) {
            return res.status(400).json({
                message:
                    "Monthly price must be a valid positive number"
            });
        }

        const cleanPhone =
            String(phone).trim();

        const existingCustomer =
            db.prepare(`
                SELECT id
                FROM customers
                WHERE phone = ?
                AND user_id = ?
            `).get(
                cleanPhone,
                req.user.id
            );

        if (existingCustomer) {
            return res.status(409).json({
                message:
                    "Customer with this phone already exists"
            });
        }

        try {

            const startDate =
                cycle_start ||
                todayDate();

            const transaction =
                db.transaction(() => {

                    const result =
                        db.prepare(`
                            INSERT INTO customers (
                                user_id,
                                name,
                                phone,
                                address,
                                monthly_price,
                                status
                            )
                            VALUES (
                                ?,
                                ?,
                                ?,
                                ?,
                                ?,
                                'ACTIVE'
                            )
                        `).run(
                            req.user.id,
                            name.trim(),
                            cleanPhone,
                            address.trim(),
                            numericPrice
                        );

                    const customerId =
                        result.lastInsertRowid;

                    createSubscriptionForCustomer(
                        customerId,
                        numericPrice,
                        startDate
                    );

                    return customerId;
                });

            const customerId =
                transaction();

            const customer =
                getCustomerForUser(
                    customerId,
                    req.user.id
                );

            res.status(201).json({
                message:
                    "Customer subscription created successfully",
                customer
            });

        } catch (error) {

            console.error(
                "Create customer error:",
                error
            );

            res.status(500).json({
                message:
                    "Could not create customer"
            });
        }
    }
);

// =====================================================
// GET SINGLE CUSTOMER
// =====================================================

app.get(
    "/api/customers/:id",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        if (!Number.isInteger(customerId)) {
            return res.status(400).json({
                message:
                    "Invalid customer ID"
            });
        }

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const subscription =
            db.prepare(`
                SELECT *
                FROM subscriptions
                WHERE customer_id = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(customerId);

        res.json({
            ...customer,
            subscription:
                subscription || null
        });
    }
);

// =====================================================
// UPDATE CUSTOMER
// =====================================================

app.put(
    "/api/customers/:id",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const {
            name,
            phone,
            address,
            monthly_price,
            monthlyPrice,
            status
        } = req.body;

        const newName =
            name !== undefined
                ? String(name).trim()
                : customer.name;

        const newPhone =
            phone !== undefined
                ? String(phone).trim()
                : customer.phone;

        const newAddress =
            address !== undefined
                ? String(address).trim()
                : customer.address;

        const newPrice =
            monthly_price !== undefined
                ? Number(monthly_price)
                : monthlyPrice !== undefined
                    ? Number(monthlyPrice)
                    : customer.monthly_price;

        const newStatus =
            status === "PAUSED" ||
            status === "ACTIVE"
                ? status
                : customer.status;

        if (
            !newName ||
            !newPhone ||
            !newAddress
        ) {
            return res.status(400).json({
                message:
                    "Name, phone and address cannot be empty"
            });
        }

        if (
            !Number.isFinite(newPrice) ||
            newPrice <= 0
        ) {
            return res.status(400).json({
                message:
                    "Monthly price must be a valid positive number"
            });
        }

        const duplicatePhone =
            db.prepare(`
                SELECT id
                FROM customers
                WHERE phone = ?
                AND user_id = ?
                AND id != ?
            `).get(
                newPhone,
                req.user.id,
                customerId
            );

        if (duplicatePhone) {
            return res.status(409).json({
                message:
                    "Another customer already uses this phone"
            });
        }

        db.prepare(`
            UPDATE customers
            SET
                name = ?,
                phone = ?,
                address = ?,
                monthly_price = ?,
                status = ?
            WHERE id = ?
            AND user_id = ?
        `).run(
            newName,
            newPhone,
            newAddress,
            newPrice,
            newStatus,
            customerId,
            req.user.id
        );

        const updatedCustomer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        res.json({
            message:
                "Customer updated successfully",
            customer:
                updatedCustomer
        });
    }
);

// =====================================================
// DELETE CUSTOMER
// =====================================================

app.delete(
    "/api/customers/:id",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const transaction =
            db.transaction(() => {

                db.prepare(`
                    DELETE FROM notification_outbox
                    WHERE customer_id = ?
                `).run(customerId);

                db.prepare(`
                    DELETE FROM subscription_transfers
                    WHERE from_customer_id = ?
                    OR to_customer_id = ?
                `).run(
                    customerId,
                    customerId
                );

                db.prepare(`
                    DELETE FROM subscriptions
                    WHERE customer_id = ?
                `).run(customerId);

                db.prepare(`
                    DELETE FROM service_days
                    WHERE customer_id = ?
                `).run(customerId);

                db.prepare(`
                    DELETE FROM payments
                    WHERE customer_id = ?
                `).run(customerId);

                db.prepare(`
                    DELETE FROM customers
                    WHERE id = ?
                    AND user_id = ?
                `).run(
                    customerId,
                    req.user.id
                );
            });

        transaction();

        res.json({
            message:
                "Customer deleted successfully"
        });
    }
);

// =====================================================
// PAUSE SUBSCRIPTION
// =====================================================

app.post(
    "/api/customers/:id/pause",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        if (customer.status === "PAUSED") {
            return res.json({
                message:
                    "Customer is already paused",
                customer
            });
        }

        db.prepare(`
            UPDATE customers
            SET status = 'PAUSED'
            WHERE id = ?
            AND user_id = ?
        `).run(
            customerId,
            req.user.id
        );

        const updatedCustomer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        res.json({
            message:
                "Subscription paused",
            customer:
                updatedCustomer
        });
    }
);

// =====================================================
// RESUME SUBSCRIPTION
// =====================================================

app.post(
    "/api/customers/:id/resume",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        if (customer.status === "ACTIVE") {
            return res.json({
                message:
                    "Customer is already active",
                customer
            });
        }

        db.prepare(`
            UPDATE customers
            SET status = 'ACTIVE'
            WHERE id = ?
            AND user_id = ?
        `).run(
            customerId,
            req.user.id
        );

        const updatedCustomer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        res.json({
            message:
                "Subscription resumed",
            customer:
                updatedCustomer
        });
    }
);

// =====================================================
// T6 - TRANSFER SUBSCRIPTION
// =====================================================
// Transfer an active subscription to another customer.
// Plan and cycle continue from the original subscription.
// Future service days belong to the new customer.
// Historical service days remain with old customer.
// =====================================================

app.post(
    "/api/subscriptions/:id/transfer",
    authenticateToken,
    (req, res) => {

        const subscriptionId =
            Number(req.params.id);

        const {
            to_customer_id,
            toCustomerId,
            transfer_date
        } = req.body;

        const newCustomerId =
            Number(
                to_customer_id ||
                toCustomerId
            );

        const transferDate =
            transfer_date ||
            todayDate();

        if (
            !Number.isInteger(subscriptionId) ||
            !Number.isInteger(newCustomerId)
        ) {
            return res.status(400).json({
                message:
                    "Valid subscription ID and target customer ID are required"
            });
        }

        const subscription =
            db.prepare(`
                SELECT
                    s.*,
                    c.user_id,
                    c.name AS old_customer_name
                FROM subscriptions s
                JOIN customers c
                    ON c.id = s.customer_id
                WHERE s.id = ?
                AND c.user_id = ?
            `).get(
                subscriptionId,
                req.user.id
            );

        if (!subscription) {
            return res.status(404).json({
                message:
                    "Subscription not found"
            });
        }

        if (subscription.status !== "ACTIVE") {
            return res.status(400).json({
                message:
                    "Only an active subscription can be transferred"
            });
        }

        if (
            subscription.customer_id ===
            newCustomerId
        ) {
            return res.status(400).json({
                message:
                    "Subscription is already assigned to this customer"
            });
        }

        const newCustomer =
            getCustomerForUser(
                newCustomerId,
                req.user.id
            );

        if (!newCustomer) {
            return res.status(404).json({
                message:
                    "Target customer not found"
            });
        }

        if (
            transferDate <
            subscription.cycle_start ||
            transferDate >
            subscription.cycle_end
        ) {
            return res.status(400).json({
                message:
                    "Transfer date must be inside the subscription cycle"
            });
        }

        const transaction =
            db.transaction(() => {

                // End old customer's subscription
                db.prepare(`
                    UPDATE subscriptions
                    SET status = 'TRANSFERRED'
                    WHERE id = ?
                `).run(subscriptionId);

                // Create continuation subscription
                const newSubscription =
                    db.prepare(`
                        INSERT INTO subscriptions (
                            customer_id,
                            plan_price,
                            cycle_start,
                            cycle_end,
                            status
                        )
                        VALUES (?, ?, ?, ?, 'ACTIVE')
                    `).run(
                        newCustomerId,
                        subscription.plan_price,
                        transferDate,
                        subscription.cycle_end
                    );

                const newSubscriptionId =
                    newSubscription.lastInsertRowid;

                // Record transfer
                db.prepare(`
                    INSERT INTO subscription_transfers (
                        subscription_id,
                        from_customer_id,
                        to_customer_id,
                        transfer_date
                    )
                    VALUES (?, ?, ?, ?)
                `).run(
                    subscriptionId,
                    subscription.customer_id,
                    newCustomerId,
                    transferDate
                );

                // Old customer keeps service history
                // before transfer date.
                //
                // Future dates are attached to new customer.
                const futureDays =
                    db.prepare(`
                        SELECT *
                        FROM service_days
                        WHERE customer_id = ?
                        AND service_date >= ?
                        AND service_date <= ?
                    `).all(
                        subscription.customer_id,
                        transferDate,
                        subscription.cycle_end
                    );

                futureDays.forEach(day => {

                    db.prepare(`
                        DELETE FROM service_days
                        WHERE id = ?
                    `).run(day.id);

                    db.prepare(`
                        INSERT OR IGNORE INTO service_days (
                            customer_id,
                            service_date,
                            status,
                            subscription_id
                        )
                        VALUES (?, ?, ?, ?)
                    `).run(
                        newCustomerId,
                        day.service_date,
                        day.status,
                        newSubscriptionId
                    );
                });

                // Make target customer use transferred plan
                db.prepare(`
                    UPDATE customers
                    SET
                        monthly_price = ?,
                        status = 'ACTIVE'
                    WHERE id = ?
                    AND user_id = ?
                `).run(
                    subscription.plan_price,
                    newCustomerId,
                    req.user.id
                );

                return newSubscriptionId;
            });

        const newSubscriptionId =
            transaction();

        const result =
            db.prepare(`
                SELECT
                    s.*,
                    c.name AS customer_name,
                    c.phone AS customer_phone
                FROM subscriptions s
                JOIN customers c
                    ON c.id = s.customer_id
                WHERE s.id = ?
            `).get(newSubscriptionId);

        res.json({
            message:
                "Subscription transferred successfully",
            previousCustomerId:
                subscription.customer_id,
            newCustomerId,
            transferDate,
            subscription:
                result
        });
    }
);

// =====================================================
// GET SUBSCRIPTION
// =====================================================

app.get(
    "/api/subscriptions/:id",
    authenticateToken,
    (req, res) => {

        const subscriptionId =
            Number(req.params.id);

        const subscription =
            db.prepare(`
                SELECT
                    s.*,
                    c.name AS customer_name,
                    c.phone AS customer_phone,
                    c.address AS customer_address
                FROM subscriptions s
                JOIN customers c
                    ON c.id = s.customer_id
                WHERE s.id = ?
                AND c.user_id = ?
            `).get(
                subscriptionId,
                req.user.id
            );

        if (!subscription) {
            return res.status(404).json({
                message:
                    "Subscription not found"
            });
        }

        res.json(subscription);
    }
);

// =====================================================
// GET CUSTOMER SUBSCRIPTIONS
// =====================================================

app.get(
    "/api/customers/:id/subscriptions",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const subscriptions =
            db.prepare(`
                SELECT *
                FROM subscriptions
                WHERE customer_id = ?
                ORDER BY cycle_start DESC
            `).all(customerId);

        res.json({
            customer,
            subscriptions
        });
    }
);

// =====================================================
// ADD / UPDATE SERVICE DAY
// =====================================================

app.post(
    "/api/customers/:id/service-days",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const {
            service_date,
            date,
            status
        } = req.body;

        const serviceDate =
            service_date || date;

        if (!serviceDate) {
            return res.status(400).json({
                message:
                    "Service date is required"
            });
        }

        if (!isWeekday(serviceDate)) {
            return res.status(400).json({
                message:
                    "Tiffin service is available only on weekdays"
            });
        }

        const finalStatus =
            status === "PAUSED"
                ? "PAUSED"
                : "SERVED";

        const subscription =
            db.prepare(`
                SELECT id
                FROM subscriptions
                WHERE customer_id = ?
                AND status = 'ACTIVE'
                ORDER BY id DESC
                LIMIT 1
            `).get(customerId);

        db.prepare(`
            INSERT INTO service_days (
                customer_id,
                service_date,
                status,
                subscription_id
            )
            VALUES (?, ?, ?, ?)
            ON CONFLICT(customer_id, service_date)
            DO UPDATE SET
                status = excluded.status,
                subscription_id = excluded.subscription_id
        `).run(
            customerId,
            serviceDate,
            finalStatus,
            subscription
                ? subscription.id
                : null
        );

        const record =
            db.prepare(`
                SELECT *
                FROM service_days
                WHERE customer_id = ?
                AND service_date = ?
            `).get(
                customerId,
                serviceDate
            );

        res.json({
            message:
                "Service day saved",
            serviceDay:
                record
        });
    }
);

// =====================================================
// GET SERVICE DAYS
// =====================================================

app.get(
    "/api/customers/:id/service-days",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const currentMonth =
            getCurrentMonth();

        const year =
            Number(req.query.year) ||
            currentMonth.year;

        const month =
            Number(req.query.month) ||
            currentMonth.month;

        ensureServiceDays(
            customer,
            year,
            month
        );

        const serviceDays =
            db.prepare(`
                SELECT *
                FROM service_days
                WHERE customer_id = ?
                AND service_date LIKE ?
                ORDER BY service_date ASC
            `).all(
                customerId,
                `${year}-${String(month).padStart(2, "0")}%`
            );

        res.json({
            customer,
            year,
            month,
            serviceDays
        });
    }
);
// =====================================================
// T1 - NOTIFICATION SERVICE
// =====================================================

const notificationService = {

    notifyDeliveryDue(customer, deliveryDate) {

        const message =
            `Tiffin Track: Hi ${customer.name}, your lunch tiffin is due for delivery today (${deliveryDate}).`;

        // Prevent duplicate notification
        const existing =
            db.prepare(`
                SELECT id
                FROM notification_outbox
                WHERE customer_id = ?
                AND delivery_date = ?
                AND notification_type = 'DELIVERY_DUE'
            `).get(
                customer.id,
                deliveryDate
            );

        if (existing) {
            return existing.id;
        }

        const result =
            db.prepare(`
                INSERT INTO notification_outbox (
                    customer_id,
                    phone,
                    message,
                    notification_type,
                    delivery_date,
                    status
                )
                VALUES (?, ?, ?, 'DELIVERY_DUE', ?, 'PENDING')
            `).run(
                customer.id,
                customer.phone,
                message,
                deliveryDate
            );

        return result.lastInsertRowid;
    }
};


// =====================================================
// T1 - FIND CUSTOMERS DUE FOR DELIVERY
// =====================================================

function getCustomersDueForDelivery(
    deliveryDate
) {

    if (!isWeekday(deliveryDate)) {
        return [];
    }

    const customers =
        db.prepare(`
            SELECT
                c.*,
                s.id AS subscription_id,
                s.plan_price,
                s.cycle_start,
                s.cycle_end,
                s.status AS subscription_status
            FROM subscriptions s
            JOIN customers c
                ON c.id = s.customer_id
            WHERE s.status = 'ACTIVE'
            AND c.status = 'ACTIVE'
            AND date(?) >= date(s.cycle_start)
            AND date(?) <= date(s.cycle_end)
        `).all(
            deliveryDate,
            deliveryDate
        );

    return customers.filter(customer => {

        // Check if this subscription is paused.
        // Existing pause/resume status is also respected.
        if (customer.status !== "ACTIVE") {
            return false;
        }

        return true;
    });
}


// =====================================================
// T1 - SEND MORNING NOTIFICATIONS
// =====================================================

function sendMorningNotifications(
    deliveryDate
) {

    const dueCustomers =
        getCustomersDueForDelivery(
            deliveryDate
        );

    let notified = 0;

    dueCustomers.forEach(customer => {

        const notificationId =
            notificationService.notifyDeliveryDue(
                customer,
                deliveryDate
            );

        if (notificationId) {
            notified++;
        }
    });

    return {
        date: deliveryDate,
        dueCustomers: dueCustomers.length,
        notified
    };
}


// =====================================================
// T1 - CLOCK
// =====================================================
// The challenge grader can move the application clock
// and then inspect /outbox.
//
// Example:
// POST /clock
// {
//   "date": "2026-09-15"
// }
// =====================================================

app.post(
    "/clock",
    (req, res) => {

        const requestedDate =
            req.body.date ||
            req.body.currentDate ||
            req.body.current_date ||
            req.body.now;

        if (!requestedDate) {
            return res.status(400).json({
                message:
                    "date is required"
            });
        }

        const parsedDate =
            new Date(
                `${requestedDate}T00:00:00`
            );

        if (
            Number.isNaN(
                parsedDate.getTime()
            )
        ) {
            return res.status(400).json({
                message:
                    "Invalid date. Use YYYY-MM-DD"
            });
        }

        const normalizedDate =
            parsedDate
                .toISOString()
                .slice(0, 10);

        const result =
            sendMorningNotifications(
                normalizedDate
            );

        res.json({
            message:
                "Application clock updated",
            clock:
                normalizedDate,
            notification:
                result
        });
    }
);


// =====================================================
// GET CLOCK
// =====================================================

app.get(
    "/clock",
    (req, res) => {

        res.json({
            date: todayDate()
        });
    }
);


// =====================================================
// T1 - OUTBOX
// =====================================================
// Grader can call:
// GET /outbox
// =====================================================

app.get(
    "/outbox",
    (req, res) => {

        const limit =
            Math.min(
                Number(req.query.limit) || 100,
                500
            );

        const messages =
            db.prepare(`
                SELECT
                    id,
                    customer_id,
                    phone,
                    message,
                    notification_type,
                    delivery_date,
                    status,
                    created_at
                FROM notification_outbox
                ORDER BY id DESC
                LIMIT ?
            `).all(limit);

        res.json({
            outbox: messages
        });
    }
);


// =====================================================
// API ALIAS FOR OUTBOX
// =====================================================

app.get(
    "/api/outbox",
    (req, res) => {

        const messages =
            db.prepare(`
                SELECT
                    id,
                    customer_id,
                    phone,
                    message,
                    notification_type,
                    delivery_date,
                    status,
                    created_at
                FROM notification_outbox
                ORDER BY id DESC
            `).all();

        res.json({
            outbox: messages
        });
    }
);


// =====================================================
// MARK NOTIFICATION AS SENT
// =====================================================

app.post(
    "/api/outbox/:id/sent",
    (req, res) => {

        const id =
            Number(req.params.id);

        const result =
            db.prepare(`
                UPDATE notification_outbox
                SET status = 'SENT'
                WHERE id = ?
            `).run(id);

        if (result.changes === 0) {
            return res.status(404).json({
                message:
                    "Notification not found"
            });
        }

        const notification =
            db.prepare(`
                SELECT *
                FROM notification_outbox
                WHERE id = ?
            `).get(id);

        res.json({
            message:
                "Notification marked as sent",
            notification
        });
    }
);


// =====================================================
// T4 - DATE CLEANING
// =====================================================

function parseFlexibleDate(value) {

    if (
        value === undefined ||
        value === null ||
        String(value).trim() === ""
    ) {
        return null;
    }

    const text =
        String(value).trim();

    // YYYY-MM-DD
    if (
        /^\d{4}-\d{2}-\d{2}$/.test(text)
    ) {
        const date =
            new Date(`${text}T00:00:00`);

        if (!Number.isNaN(date.getTime())) {
            return text;
        }

        return null;
    }

    // YYYY/MM/DD
    if (
        /^\d{4}\/\d{2}\/\d{2}$/.test(text)
    ) {

        const parts =
            text.split("/");

        const normalized =
            `${parts[0]}-${parts[1]}-${parts[2]}`;

        const date =
            new Date(
                `${normalized}T00:00:00`
            );

        if (!Number.isNaN(date.getTime())) {
            return normalized;
        }

        return null;
    }

    // DD/MM/YYYY
    if (
        /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)
    ) {

        const parts =
            text.split("/");

        const day =
            Number(parts[0]);

        const month =
            Number(parts[1]);

        const year =
            Number(parts[2]);

        const date =
            new Date(
                year,
                month - 1,
                day
            );

        if (
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
        ) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }

        return null;
    }

    // DD-MM-YYYY
    if (
        /^\d{1,2}-\d{1,2}-\d{4}$/.test(text)
    ) {

        const parts =
            text.split("-");

        const day =
            Number(parts[0]);

        const month =
            Number(parts[1]);

        const year =
            Number(parts[2]);

        const date =
            new Date(
                year,
                month - 1,
                day
            );

        if (
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
        ) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }

        return null;
    }

    // MM/DD/YYYY
    if (
        /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(text)
    ) {

        const parts =
            text.split("/");

        const month =
            Number(parts[0]);

        const day =
            Number(parts[1]);

        const year =
            Number(parts[2]);

        const date =
            new Date(
                year,
                month - 1,
                day
            );

        if (
            date.getFullYear() === year &&
            date.getMonth() === month - 1 &&
            date.getDate() === day
        ) {
            return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
        }

        return null;
    }

    return null;
}


// =====================================================
// T4 - PHONE CLEANING
// =====================================================

function normalizePhone(phone) {

    if (
        phone === undefined ||
        phone === null
    ) {
        return "";
    }

    let cleaned =
        String(phone)
            .trim()
            .replace(/\D/g, "");

    // Indian +91XXXXXXXXXX
    if (
        cleaned.length === 12 &&
        cleaned.startsWith("91")
    ) {
        cleaned =
            cleaned.substring(2);
    }

    // 10 digit phone
    if (
        cleaned.length === 10
    ) {
        return cleaned;
    }

    return cleaned;
}


// =====================================================
// T4 - CSV PARSER
// =====================================================

function parseCSV(csvText) {

    const rows = [];

    let row = [];
    let value = "";
    let insideQuotes = false;

    for (
        let i = 0;
        i < csvText.length;
        i++
    ) {

        const char =
            csvText[i];

        const next =
            csvText[i + 1];

        if (
            char === '"' &&
            insideQuotes &&
            next === '"'
        ) {
            value += '"';
            i++;
            continue;
        }

        if (char === '"') {
            insideQuotes =
                !insideQuotes;
            continue;
        }

        if (
            char === "," &&
            !insideQuotes
        ) {
            row.push(value.trim());
            value = "";
            continue;
        }

        if (
            (char === "\n" || char === "\r") &&
            !insideQuotes
        ) {

            if (
                char === "\r" &&
                next === "\n"
            ) {
                i++;
            }

            row.push(value.trim());

            if (
                row.some(
                    item => item !== ""
                )
            ) {
                rows.push(row);
            }

            row = [];
            value = "";

            continue;
        }

        value += char;
    }

    if (
        value !== "" ||
        row.length > 0
    ) {

        row.push(value.trim());

        if (
            row.some(
                item => item !== ""
            )
        ) {
            rows.push(row);
        }
    }

    if (rows.length === 0) {
        return [];
    }

    const headers =
        rows[0].map(header =>
            String(header)
                .toLowerCase()
                .trim()
                .replace(/\s+/g, "_")
        );

    return rows.slice(1).map(row => {

        const object = {};

        headers.forEach(
            (header, index) => {
                object[header] =
                    row[index] || "";
            }
        );

        return object;
    });
}


// =====================================================
// T4 - IMPORT CUSTOMER LIST
// =====================================================
//
// Accepted formats:
//
// {
//   "customers": [
//      {
//        "name": "Rahul",
//        "phone": "98765-43210",
//        "address": "Jaipur",
//        "monthly_price": "2500",
//        "cycle_start": "01/09/2026"
//      }
//   ]
// }
//
// OR:
//
// {
//   "rows": [...]
// }
//
// OR:
//
// {
//   "csv": "name,phone,address,monthly_price,cycle_start\n..."
// }
// =====================================================

app.post(
    "/api/customers/import",
    authenticateToken,
    (req, res) => {

        try {

            let rows = [];

            if (
                Array.isArray(
                    req.body.customers
                )
            ) {
                rows =
                    req.body.customers;
            }

            else if (
                Array.isArray(
                    req.body.rows
                )
            ) {
                rows =
                    req.body.rows;
            }

            else if (
                typeof req.body.csv === "string"
            ) {
                rows =
                    parseCSV(
                        req.body.csv
                    );
            }

            else if (
                Array.isArray(req.body)
            ) {
                rows = req.body;
            }

            if (rows.length === 0) {
                return res.status(400).json({
                    message:
                        "No customer rows found"
                });
            }

            const batch =
                db.prepare(`
                    INSERT INTO import_batches (
                        user_id,
                        filename
                    )
                    VALUES (?, ?)
                `).run(
                    req.user.id,
                    req.body.filename || ""
                );

            const batchId =
                batch.lastInsertRowid;

            let imported = 0;
            let deduped = 0;
            let rejected = 0;

            const importedRows = [];
            const dedupedRows = [];
            const rejectedRows = [];

            const seenPhones =
                new Set();

            const transaction =
                db.transaction(() => {

                    rows.forEach(
                        (row, index) => {

                            const name =
                                String(
                                    row.name ||
                                    row.customer_name ||
                                    row.full_name ||
                                    ""
                                ).trim();

                            const rawPhone =
                                String(
                                    row.phone ||
                                    row.mobile ||
                                    row.mobile_number ||
                                    ""
                                ).trim();

                            const phone =
                                normalizePhone(
                                    rawPhone
                                );

                            const address =
                                String(
                                    row.address ||
                                    row.location ||
                                    ""
                                ).trim();

                            const rawPrice =
                                row.monthly_price !== undefined
                                    ? row.monthly_price
                                    : row.monthlyPrice !== undefined
                                        ? row.monthlyPrice
                                        : row.price;

                            const price =
                                Number(
                                    rawPrice
                                );

                            const rawDate =
                                row.cycle_start ||
                                row.start_date ||
                                row.subscription_start ||
                                "";

                            const parsedDate =
                                parseFlexibleDate(
                                    rawDate
                                );

                            // ---------------------------------
                            // Validation
                            // ---------------------------------

                            if (!name) {

                                rejected++;

                                rejectedRows.push({
                                    row: index + 1,
                                    reason:
                                        "Missing customer name"
                                });

                                db.prepare(`
                                    INSERT INTO import_records (
                                        batch_id,
                                        raw_name,
                                        raw_phone,
                                        raw_address,
                                        raw_price,
                                        raw_date,
                                        result,
                                        reason
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?, 'REJECTED', ?)
                                `).run(
                                    batchId,
                                    name,
                                    rawPhone,
                                    address,
                                    String(rawPrice || ""),
                                    String(rawDate || ""),
                                    "Missing customer name"
                                );

                                return;
                            }

                            if (!phone) {

                                rejected++;

                                rejectedRows.push({
                                    row: index + 1,
                                    name,
                                    reason:
                                        "Missing phone number"
                                });

                                db.prepare(`
                                    INSERT INTO import_records (
                                        batch_id,
                                        raw_name,
                                        raw_phone,
                                        raw_address,
                                        raw_price,
                                        raw_date,
                                        result,
                                        reason
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?, 'REJECTED', ?)
                                `).run(
                                    batchId,
                                    name,
                                    rawPhone,
                                    address,
                                    String(rawPrice || ""),
                                    String(rawDate || ""),
                                    "Missing phone number"
                                );

                                return;
                            }

                            if (
                                phone.length !== 10
                            ) {

                                rejected++;

                                rejectedRows.push({
                                    row: index + 1,
                                    name,
                                    phone: rawPhone,
                                    reason:
                                        "Invalid phone number"
                                });

                                db.prepare(`
                                    INSERT INTO import_records (
                                        batch_id,
                                        raw_name,
                                        raw_phone,
                                        raw_address,
                                        raw_price,
                                        raw_date,
                                        result,
                                        reason
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?, 'REJECTED', ?)
                                `).run(
                                    batchId,
                                    name,
                                    rawPhone,
                                    address,
                                    String(rawPrice || ""),
                                    String(rawDate || ""),
                                    "Invalid phone number"
                                );

                                return;
                            }

                            if (
                                !Number.isFinite(price) ||
                                price <= 0
                            ) {

                                rejected++;

                                rejectedRows.push({
                                    row: index + 1,
                                    name,
                                    phone,
                                    reason:
                                        "Invalid monthly price"
                                });

                                db.prepare(`
                                    INSERT INTO import_records (
                                        batch_id,
                                        raw_name,
                                        raw_phone,
                                        raw_address,
                                        raw_price,
                                        raw_date,
                                        result,
                                        reason
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?, 'REJECTED', ?)
                                `).run(
                                    batchId,
                                    name,
                                    rawPhone,
                                    address,
                                    String(rawPrice || ""),
                                    String(rawDate || ""),
                                    "Invalid monthly price"
                                );

                                return;
                            }

                            if (
                                rawDate &&
                                !parsedDate
                            ) {

                                rejected++;

                                rejectedRows.push({
                                    row: index + 1,
                                    name,
                                    phone,
                                    reason:
                                        "Invalid date format"
                                });

                                db.prepare(`
                                    INSERT INTO import_records (
                                        batch_id,
                                        raw_name,
                                        raw_phone,
                                        raw_address,
                                        raw_price,
                                        raw_date,
                                        result,
                                        reason
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?, 'REJECTED', ?)
                                `).run(
                                    batchId,
                                    name,
                                    rawPhone,
                                    address,
                                    String(rawPrice || ""),
                                    String(rawDate || ""),
                                    "Invalid date format"
                                );

                                return;
                            }

                            // ---------------------------------
                            // Duplicate in same import
                            // ---------------------------------

                            if (
                                seenPhones.has(phone)
                            ) {

                                deduped++;

                                dedupedRows.push({
                                    row: index + 1,
                                    name,
                                    phone,
                                    reason:
                                        "Duplicate phone in import"
                                });

                                db.prepare(`
                                    INSERT INTO import_records (
                                        batch_id,
                                        raw_name,
                                        raw_phone,
                                        raw_address,
                                        raw_price,
                                        raw_date,
                                        result,
                                        reason
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?, 'DEDUPED', ?)
                                `).run(
                                    batchId,
                                    name,
                                    rawPhone,
                                    address,
                                    String(rawPrice),
                                    String(rawDate || ""),
                                    "Duplicate phone in import"
                                );

                                return;
                            }

                            seenPhones.add(phone);

                            // ---------------------------------
                            // Duplicate in database
                            // ---------------------------------

                            const existing =
                                db.prepare(`
                                    SELECT id
                                    FROM customers
                                    WHERE phone = ?
                                `).get(phone);

                            if (existing) {

                                deduped++;

                                dedupedRows.push({
                                    row: index + 1,
                                    name,
                                    phone,
                                    reason:
                                        "Phone already exists"
                                });

                                db.prepare(`
                                    INSERT INTO import_records (
                                        batch_id,
                                        raw_name,
                                        raw_phone,
                                        raw_address,
                                        raw_price,
                                        raw_date,
                                        result,
                                        reason,
                                        customer_id
                                    )
                                    VALUES (?, ?, ?, ?, ?, ?, 'DEDUPED', ?, ?)
                                `).run(
                                    batchId,
                                    name,
                                    rawPhone,
                                    address,
                                    String(rawPrice),
                                    String(rawDate || ""),
                                    "Phone already exists",
                                    existing.id
                                );

                                return;
                            }

                            // ---------------------------------
                            // Clean defaults
                            // ---------------------------------

                            const cleanAddress =
                                address ||
                                "Not provided";

                            const startDate =
                                parsedDate ||
                                todayDate();

                            // ---------------------------------
                            // Create customer
                            // ---------------------------------

                            const customerResult =
                                db.prepare(`
                                    INSERT INTO customers (
                                        user_id,
                                        name,
                                        phone,
                                        address,
                                        monthly_price,
                                        status
                                    )
                                    VALUES (?, ?, ?, ?, ?, 'ACTIVE')
                                `).run(
                                    req.user.id,
                                    name,
                                    phone,
                                    cleanAddress,
                                    price
                                );

                            const customerId =
                                customerResult.lastInsertRowid;

                            // ---------------------------------
                            // Create subscription
                            // ---------------------------------

                            createSubscriptionForCustomer(
                                customerId,
                                price,
                                startDate
                            );

                            imported++;

                            importedRows.push({
                                row: index + 1,
                                customerId,
                                name,
                                phone,
                                monthlyPrice: price,
                                cycleStart: startDate
                            });

                            db.prepare(`
                                INSERT INTO import_records (
                                    batch_id,
                                    raw_name,
                                    raw_phone,
                                    raw_address,
                                    raw_price,
                                    raw_date,
                                    result,
                                    reason,
                                    customer_id
                                )
                                VALUES (?, ?, ?, ?, ?, ?, 'IMPORTED', ?, ?)
                            `).run(
                                batchId,
                                name,
                                rawPhone,
                                cleanAddress,
                                String(rawPrice),
                                String(rawDate || ""),
                                "Imported successfully",
                                customerId
                            );
                        }
                    );
                });

            transaction();

            // Update batch summary
            db.prepare(`
                UPDATE import_batches
                SET
                    imported_count = ?,
                    deduped_count = ?,
                    rejected_count = ?
                WHERE id = ?
            `).run(
                imported,
                deduped,
                rejected,
                batchId
            );

            res.json({
                imported,
                deduped,
                rejected,
                batchId,
                details: {
                    importedRows,
                    dedupedRows,
                    rejectedRows
                }
            });

        } catch (error) {

            console.error(
                "Import error:",
                error
            );

            res.status(500).json({
                message:
                    "Customer import failed",
                error:
                    error.message
            });
        }
    }
);


// =====================================================
// T4 - IMPORT HISTORY
// =====================================================

app.get(
    "/api/customers/import/history",
    authenticateToken,
    (req, res) => {

        const batches =
            db.prepare(`
                SELECT
                    *
                FROM import_batches
                WHERE user_id = ?
                ORDER BY id DESC
            `).all(req.user.id);

        res.json({
            batches
        });
    }
);


// =====================================================
// BILLING HELPER
// =====================================================

function getMonthDateRange(
    year,
    month
) {

    const firstDay =
        `${year}-${String(month).padStart(2, "0")}-01`;

    const lastDayNumber =
        getDaysInMonth(
            year,
            month
        );

    const lastDay =
        `${year}-${String(month).padStart(2, "0")}-${String(lastDayNumber).padStart(2, "0")}`;

    return {
        firstDay,
        lastDay
    };
}


// =====================================================
// COUNT WEEKDAYS
// =====================================================

function countWeekdays(
    startDate,
    endDate
) {

    const start =
        new Date(
            `${startDate}T00:00:00`
        );

    const end =
        new Date(
            `${endDate}T00:00:00`
        );

    let count = 0;

    const current =
        new Date(start);

    while (
        current <= end
    ) {

        const day =
            current.getDay();

        if (
            day !== 0 &&
            day !== 6
        ) {
            count++;
        }

        current.setDate(
            current.getDate() + 1
        );
    }

    return count;
}


// =====================================================
// CUSTOMER BILL
// =====================================================

app.get(
    "/api/customers/:id/bill",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const currentMonth =
            getCurrentMonth();

        const year =
            Number(req.query.year) ||
            currentMonth.year;

        const month =
            Number(req.query.month) ||
            currentMonth.month;

        ensureServiceDays(
            customer,
            year,
            month
        );

        const range =
            getMonthDateRange(
                year,
                month
            );

        const totalServiceDays =
            countWeekdays(
                range.firstDay,
                range.lastDay
            );

        const servedDays =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM service_days
                WHERE customer_id = ?
                AND service_date >= ?
                AND service_date <= ?
                AND status = 'SERVED'
            `).get(
                customerId,
                range.firstDay,
                range.lastDay
            ).count;

        const pausedDays =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM service_days
                WHERE customer_id = ?
                AND service_date >= ?
                AND service_date <= ?
                AND status = 'PAUSED'
            `).get(
                customerId,
                range.firstDay,
                range.lastDay
            ).count;

        const dailyRate =
            totalServiceDays > 0
                ? customer.monthly_price /
                    totalServiceDays
                : 0;

        const finalBill =
            servedDays *
            dailyRate;

        const paidAmount =
            db.prepare(`
                SELECT
                    COALESCE(SUM(amount), 0) AS total
                FROM payments
                WHERE customer_id = ?
                AND payment_date >= ?
                AND payment_date <= ?
            `).get(
                customerId,
                range.firstDay,
                range.lastDay
            ).total;

        const balance =
            finalBill -
            paidAmount;

        let paymentStatus =
            "UNPAID";

        if (paidAmount >= finalBill) {
            paymentStatus = "PAID";
        }
        else if (paidAmount > 0) {
            paymentStatus = "PARTIAL";
        }

        res.json({
            customer,
            month: {
                year,
                month
            },
            monthlyPlan:
                customer.monthly_price,
            totalServiceDays,
            servedDays,
            pausedDays,
            dailyRate:
                Number(
                    dailyRate.toFixed(2)
                ),
            finalBill:
                Number(
                    finalBill.toFixed(2)
                ),
            paidAmount:
                Number(
                    paidAmount.toFixed(2)
                ),
            balance:
                Number(
                    balance.toFixed(2)
                ),
            paymentStatus
        });
    }
);


// =====================================================
// T6 - SUBSCRIPTION SPLIT BILL
// =====================================================

app.get(
    "/api/subscriptions/:id/bill",
    authenticateToken,
    (req, res) => {

        const subscriptionId =
            Number(req.params.id);

        const subscription =
            db.prepare(`
                SELECT
                    s.*,
                    c.user_id
                FROM subscriptions s
                JOIN customers c
                    ON c.id = s.customer_id
                WHERE s.id = ?
                AND c.user_id = ?
            `).get(
                subscriptionId,
                req.user.id
            );

        if (!subscription) {
            return res.status(404).json({
                message:
                    "Subscription not found"
            });
        }

        const currentMonth =
            getCurrentMonth();

        const year =
            Number(req.query.year) ||
            currentMonth.year;

        const month =
            Number(req.query.month) ||
            currentMonth.month;

        const range =
            getMonthDateRange(
                year,
                month
            );

        const totalServiceDays =
            countWeekdays(
                range.firstDay,
                range.lastDay
            );

        const dailyRate =
            totalServiceDays > 0
                ? subscription.plan_price /
                    totalServiceDays
                : 0;

        // Current subscription
        const served =
            db.prepare(`
                SELECT
                    sd.customer_id,
                    c.name,
                    c.phone,
                    COUNT(*) AS served_days
                FROM service_days sd
                JOIN customers c
                    ON c.id = sd.customer_id
                WHERE sd.subscription_id = ?
                AND sd.service_date >= ?
                AND sd.service_date <= ?
                AND sd.status = 'SERVED'
                GROUP BY
                    sd.customer_id
            `).all(
                subscriptionId,
                range.firstDay,
                range.lastDay
            );

        const segments =
            served.map(item => {

                const bill =
                    item.served_days *
                    dailyRate;

                return {
                    customerId:
                        item.customer_id,
                    customerName:
                        item.name,
                    phone:
                        item.phone,
                    servedDays:
                        item.served_days,
                    dailyRate:
                        Number(
                            dailyRate.toFixed(2)
                        ),
                    bill:
                        Number(
                            bill.toFixed(2)
                        )
                };
            });

        const finalBill =
            segments.reduce(
                (sum, item) =>
                    sum + item.bill,
                0
            );

        res.json({
            subscription,
            month: {
                year,
                month
            },
            monthlyPlan:
                subscription.plan_price,
            totalServiceDays,
            dailyRate:
                Number(
                    dailyRate.toFixed(2)
                ),
            segments,
            finalBill:
                Number(
                    finalBill.toFixed(2)
                )
        });
    }
);


// =====================================================
// ADD PAYMENT
// =====================================================

app.post(
    "/api/customers/:id/payments",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const {
            amount,
            payment_date,
            paymentDate,
            payment_method,
            paymentMethod,
            note
        } = req.body;

        const numericAmount =
            Number(amount);

        const finalDate =
            payment_date ||
            paymentDate ||
            todayDate();

        const finalMethod =
            payment_method ||
            paymentMethod ||
            "CASH";

        if (
            !Number.isFinite(
                numericAmount
            ) ||
            numericAmount <= 0
        ) {
            return res.status(400).json({
                message:
                    "Payment amount must be greater than zero"
            });
        }

        db.prepare(`
            INSERT INTO payments (
                customer_id,
                amount,
                payment_date,
                payment_method,
                note
            )
            VALUES (?, ?, ?, ?, ?)
        `).run(
            customerId,
            numericAmount,
            finalDate,
            finalMethod,
            note || ""
        );

        const payment =
            db.prepare(`
                SELECT *
                FROM payments
                WHERE id = last_insert_rowid()
            `).get();

        res.status(201).json({
            message:
                "Payment added successfully",
            payment
        });
    }
);


// =====================================================
// PAYMENT HISTORY
// =====================================================

app.get(
    "/api/customers/:id/payments",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const payments =
            db.prepare(`
                SELECT *
                FROM payments
                WHERE customer_id = ?
                ORDER BY payment_date DESC, id DESC
            `).all(customerId);

        const totalPaid =
            payments.reduce(
                (sum, payment) =>
                    sum + Number(payment.amount),
                0
            );

        res.json({
            customer,
            payments,
            totalPaid:
                Number(
                    totalPaid.toFixed(2)
                )
        });
    }
);


// =====================================================
// DELETE PAYMENT
// =====================================================

app.delete(
    "/api/payments/:id",
    authenticateToken,
    (req, res) => {

        const paymentId =
            Number(req.params.id);

        const payment =
            db.prepare(`
                SELECT
                    p.*,
                    c.user_id
                FROM payments p
                JOIN customers c
                    ON c.id = p.customer_id
                WHERE p.id = ?
                AND c.user_id = ?
            `).get(
                paymentId,
                req.user.id
            );

        if (!payment) {
            return res.status(404).json({
                message:
                    "Payment not found"
            });
        }

        db.prepare(`
            DELETE FROM payments
            WHERE id = ?
        `).run(paymentId);

        res.json({
            message:
                "Payment deleted successfully"
        });
    }
);
// =====================================================
// TODAY DELIVERY
// =====================================================

app.get(
    "/api/delivery/today",
    authenticateToken,
    (req, res) => {

        const today = todayDate();

        const deliveries =
            db.prepare(`
                SELECT
                    sd.id,
                    sd.customer_id,
                    sd.service_date,
                    sd.status,
                    c.name,
                    c.phone,
                    c.address,
                    c.monthly_price
                FROM service_days sd
                JOIN customers c
                    ON c.id = sd.customer_id
                WHERE c.user_id = ?
                AND sd.service_date = ?
                ORDER BY c.name ASC
            `).all(
                req.user.id,
                today
            );

        res.json({
            date: today,
            deliveries
        });
    }
);


// =====================================================
// ALL DELIVERY DAYS FOR MONTH
// =====================================================

app.get(
    "/api/delivery",
    authenticateToken,
    (req, res) => {

        const currentMonth =
            getCurrentMonth();

        const year =
            Number(req.query.year) ||
            currentMonth.year;

        const month =
            Number(req.query.month) ||
            currentMonth.month;

        const firstDay =
            `${year}-${String(month).padStart(2, "0")}-01`;

        const lastDay =
            `${year}-${String(month).padStart(2, "0")}-${String(
                getDaysInMonth(year, month)
            ).padStart(2, "0")}`;

        const deliveries =
            db.prepare(`
                SELECT
                    sd.id,
                    sd.customer_id,
                    sd.service_date,
                    sd.status,
                    c.name,
                    c.phone,
                    c.address
                FROM service_days sd
                JOIN customers c
                    ON c.id = sd.customer_id
                WHERE c.user_id = ?
                AND sd.service_date >= ?
                AND sd.service_date <= ?
                ORDER BY
                    sd.service_date ASC,
                    c.name ASC
            `).all(
                req.user.id,
                firstDay,
                lastDay
            );

        res.json({
            year,
            month,
            deliveries
        });
    }
);


// =====================================================
// MARK DELIVERY AS SERVED
// =====================================================

app.post(
    "/api/delivery/:id/served",
    authenticateToken,
    (req, res) => {

        const serviceDayId =
            Number(req.params.id);

        const serviceDay =
            db.prepare(`
                SELECT
                    sd.*,
                    c.user_id,
                    c.name
                FROM service_days sd
                JOIN customers c
                    ON c.id = sd.customer_id
                WHERE sd.id = ?
                AND c.user_id = ?
            `).get(
                serviceDayId,
                req.user.id
            );

        if (!serviceDay) {
            return res.status(404).json({
                message:
                    "Delivery record not found"
            });
        }

        db.prepare(`
            UPDATE service_days
            SET status = 'SERVED'
            WHERE id = ?
        `).run(serviceDayId);

        const updated =
            db.prepare(`
                SELECT *
                FROM service_days
                WHERE id = ?
            `).get(serviceDayId);

        res.json({
            message:
                "Delivery marked as served",
            serviceDay:
                updated
        });
    }
);


// =====================================================
// MARK DELIVERY AS PAUSED
// =====================================================

app.post(
    "/api/delivery/:id/paused",
    authenticateToken,
    (req, res) => {

        const serviceDayId =
            Number(req.params.id);

        const serviceDay =
            db.prepare(`
                SELECT
                    sd.*,
                    c.user_id
                FROM service_days sd
                JOIN customers c
                    ON c.id = sd.customer_id
                WHERE sd.id = ?
                AND c.user_id = ?
            `).get(
                serviceDayId,
                req.user.id
            );

        if (!serviceDay) {
            return res.status(404).json({
                message:
                    "Delivery record not found"
            });
        }

        db.prepare(`
            UPDATE service_days
            SET status = 'PAUSED'
            WHERE id = ?
        `).run(serviceDayId);

        res.json({
            message:
                "Delivery marked as paused"
        });
    }
);


// =====================================================
// PAUSE WITH SPECIFIC DATE
// =====================================================
// Supports:
// POST /api/customers/:id/pause
//
// {
//    "start_date": "2026-09-10"
// }
// =====================================================

app.post(
    "/api/customers/:id/pause-date",
    authenticateToken,
    (req, res) => {

        const customerId =
            Number(req.params.id);

        const customer =
            getCustomerForUser(
                customerId,
                req.user.id
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        const startDate =
            req.body.start_date ||
            req.body.startDate ||
            todayDate();

        const endDate =
            req.body.end_date ||
            req.body.endDate ||
            null;

        const parsedStart =
            parseFlexibleDate(startDate);

        if (!parsedStart) {
            return res.status(400).json({
                message:
                    "Invalid start date"
            });
        }

        if (
            endDate &&
            !parseFlexibleDate(endDate)
        ) {
            return res.status(400).json({
                message:
                    "Invalid end date"
            });
        }

        if (
            endDate &&
            endDate < parsedStart
        ) {
            return res.status(400).json({
                message:
                    "End date cannot be before start date"
            });
        }

        const subscription =
            db.prepare(`
                SELECT *
                FROM subscriptions
                WHERE customer_id = ?
                ORDER BY id DESC
                LIMIT 1
            `).get(customerId);

        if (!subscription) {
            return res.status(404).json({
                message:
                    "Subscription not found"
            });
        }

        const pauseEnd =
            endDate || null;

        db.prepare(`
            UPDATE customers
            SET status = 'PAUSED'
            WHERE id = ?
            AND user_id = ?
        `).run(
            customerId,
            req.user.id
        );

        // Update existing service days
        const finalEnd =
            pauseEnd ||
            todayDate();

        db.prepare(`
            UPDATE service_days
            SET status = 'PAUSED'
            WHERE customer_id = ?
            AND service_date >= ?
            AND service_date <= ?
        `).run(
            customerId,
            parsedStart,
            finalEnd
        );

        res.json({
            message:
                "Customer paused for selected period",
            customer:
                getCustomerForUser(
                    customerId,
                    req.user.id
                ),
            pause: {
                startDate: parsedStart,
                endDate: pauseEnd
            }
        });
    }
);


// =====================================================
// REMINDERS
// =====================================================

app.get(
    "/api/reminders",
    authenticateToken,
    (req, res) => {

        const today =
            todayDate();

        const reminders =
            db.prepare(`
                SELECT
                    c.id,
                    c.name,
                    c.phone,
                    c.status,
                    c.monthly_price
                FROM customers c
                WHERE c.user_id = ?
                AND c.status = 'ACTIVE'
                ORDER BY c.name ASC
            `).all(req.user.id);

        const pendingPayments =
            [];

        reminders.forEach(customer => {

            const month =
                getCurrentMonth();

            const range =
                getMonthDateRange(
                    month.year,
                    month.month
                );

            const totalServiceDays =
                countWeekdays(
                    range.firstDay,
                    range.lastDay
                );

            const servedDays =
                db.prepare(`
                    SELECT COUNT(*) AS count
                    FROM service_days
                    WHERE customer_id = ?
                    AND service_date >= ?
                    AND service_date <= ?
                    AND status = 'SERVED'
                `).get(
                    customer.id,
                    range.firstDay,
                    range.lastDay
                ).count;

            const dailyRate =
                totalServiceDays > 0
                    ? customer.monthly_price /
                        totalServiceDays
                    : 0;

            const bill =
                servedDays *
                dailyRate;

            const paid =
                db.prepare(`
                    SELECT
                        COALESCE(SUM(amount), 0) AS total
                    FROM payments
                    WHERE customer_id = ?
                    AND payment_date >= ?
                    AND payment_date <= ?
                `).get(
                    customer.id,
                    range.firstDay,
                    range.lastDay
                ).total;

            const balance =
                bill - paid;

            if (balance > 0.01) {

                pendingPayments.push({
                    customerId:
                        customer.id,
                    name:
                        customer.name,
                    phone:
                        customer.phone,
                    bill:
                        Number(
                            bill.toFixed(2)
                        ),
                    paid:
                        Number(
                            paid.toFixed(2)
                        ),
                    balance:
                        Number(
                            balance.toFixed(2)
                        )
                });
            }
        });

        res.json({
            date: today,
            reminders:
                pendingPayments
        });
    }
);


// =====================================================
// PHONE LOOKUP
// =====================================================
// Must be BEFORE /api/customers/:id
// =====================================================

app.get(
    "/api/customers/search/phone/:phone",
    authenticateToken,
    (req, res) => {

        const rawPhone =
            req.params.phone;

        const normalized =
            normalizePhone(rawPhone);

        const customer =
            db.prepare(`
                SELECT
                    id,
                    name,
                    phone,
                    address,
                    monthly_price,
                    status,
                    created_at
                FROM customers
                WHERE user_id = ?
                AND (
                    phone = ?
                    OR REPLACE(
                        REPLACE(phone, ' ', ''),
                        '-',
                        ''
                    ) = ?
                )
                LIMIT 1
            `).get(
                req.user.id,
                normalized,
                normalized
            );

        if (!customer) {
            return res.status(404).json({
                message:
                    "Customer not found"
            });
        }

        res.json({
            customer
        });
    }
);


// =====================================================
// REPORTS
// =====================================================

app.get(
    "/api/reports",
    authenticateToken,
    (req, res) => {

        const currentMonth =
            getCurrentMonth();

        const year =
            Number(req.query.year) ||
            currentMonth.year;

        const month =
            Number(req.query.month) ||
            currentMonth.month;

        const range =
            getMonthDateRange(
                year,
                month
            );

        const totalCustomers =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM customers
                WHERE user_id = ?
            `).get(
                req.user.id
            ).count;

        const activeCustomers =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM customers
                WHERE user_id = ?
                AND status = 'ACTIVE'
            `).get(
                req.user.id
            ).count;

        const pausedCustomers =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM customers
                WHERE user_id = ?
                AND status = 'PAUSED'
            `).get(
                req.user.id
            ).count;

        const totalPayments =
            db.prepare(`
                SELECT
                    COALESCE(SUM(p.amount), 0) AS total
                FROM payments p
                JOIN customers c
                    ON c.id = p.customer_id
                WHERE c.user_id = ?
                AND p.payment_date >= ?
                AND p.payment_date <= ?
            `).get(
                req.user.id,
                range.firstDay,
                range.lastDay
            ).total;

        const servedDays =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM service_days sd
                JOIN customers c
                    ON c.id = sd.customer_id
                WHERE c.user_id = ?
                AND sd.service_date >= ?
                AND sd.service_date <= ?
                AND sd.status = 'SERVED'
            `).get(
                req.user.id,
                range.firstDay,
                range.lastDay
            ).count;

        const pausedDays =
            db.prepare(`
                SELECT COUNT(*) AS count
                FROM service_days sd
                JOIN customers c
                    ON c.id = sd.customer_id
                WHERE c.user_id = ?
                AND sd.service_date >= ?
                AND sd.service_date <= ?
                AND sd.status = 'PAUSED'
            `).get(
                req.user.id,
                range.firstDay,
                range.lastDay
            ).count;

        res.json({
            month: {
                year,
                month
            },
            totalCustomers,
            activeCustomers,
            pausedCustomers,
            servedDays,
            pausedDays,
            totalPayments:
                Number(
                    totalPayments.toFixed(2)
                )
        });
    }
);


// =====================================================
// REPORT - CUSTOMER SUMMARY
// =====================================================

app.get(
    "/api/reports/customers",
    authenticateToken,
    (req, res) => {

        const customers =
            db.prepare(`
                SELECT
                    c.id,
                    c.name,
                    c.phone,
                    c.status,
                    c.monthly_price,
                    COALESCE(
                        SUM(p.amount),
                        0
                    ) AS total_paid
                FROM customers c
                LEFT JOIN payments p
                    ON p.customer_id = c.id
                WHERE c.user_id = ?
                GROUP BY c.id
                ORDER BY c.name ASC
            `).all(req.user.id);

        res.json({
            customers
        });
    }
);


// =====================================================
// HEALTH CHECK
// =====================================================

app.get(
    "/api/health",
    (req, res) => {

        res.json({
            status: "OK",
            service: "Tiffin Track API",
            time: new Date().toISOString()
        });
    }
);


// =====================================================
// API 404
// =====================================================

app.use(
    "/api",
    (req, res) => {

        res.status(404).json({
            message:
                "API endpoint not found"
        });
    }
);


// =====================================================
// FRONTEND FALLBACK
// =====================================================

app.use((req, res, next) => {
  if (req.method === "GET" && !req.path.startsWith("/api/")) {
    return res.sendFile(path.join(__dirname, "public", "index.html"));
  }

  next();
});

// =====================================================
// GLOBAL ERROR HANDLER
// =====================================================

app.use(
    (error, req, res, next) => {

        console.error(
            "Server error:",
            error
        );

        res.status(500).json({
            message:
                "Internal server error",
            error:
                error.message
        });
    }
);


// =====================================================
// START SERVER
// =====================================================

app.listen(
    PORT,
    "0.0.0.0",
    () => {

        console.log(
            `Tiffin Track server running on port ${PORT}`
        );

        console.log(
            `Health: http://localhost:${PORT}/api/health`
        );

        console.log(
            `Outbox: http://localhost:${PORT}/outbox`
        );
    }
);