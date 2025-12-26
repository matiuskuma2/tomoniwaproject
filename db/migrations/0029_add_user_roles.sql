-- Migration 0029: Add role column to users table
-- Date: 2025-12-26
-- Purpose: Enable role-based access control for admin features

-- Add role column with default 'user'
ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user' CHECK (role IN ('user', 'admin', 'super_admin'));

-- Create index for role lookups
CREATE INDEX IF NOT EXISTS idx_users_role ON users(role) WHERE role != 'user';
