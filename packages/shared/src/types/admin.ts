/**
 * Admin User Types
 */

export type AdminRole = 'super_admin' | 'admin';

export interface AdminUser {
  id: string;
  email: string;
  display_name: string | null;
  role: AdminRole;
  is_active: boolean;
  created_at: number;
  updated_at: number;
}

export interface AdminWorkspaceAccess {
  admin_id: string;
  workspace_id: string;
  created_at: number;
}
