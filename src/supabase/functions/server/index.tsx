import { Hono } from 'npm:hono';
import { cors } from 'npm:hono/cors';
import { logger } from 'npm:hono/logger';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import * as kv from './kv_store.tsx';
import { sendEmail, getWelcomeEmailHTML, getOTPEmailHTML } from './email-service.tsx';

const app = new Hono();

// CORS middleware
app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowHeaders: ['Content-Type', 'Authorization'],
}));

// Logger middleware
app.use('*', logger(console.log));

// Create Supabase client with service role key (for admin operations)
const supabase = createClient(
  Deno.env.get('SUPABASE_URL')!,
  Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
);

// Helper function to verify user authentication
async function verifyUser(authHeader: string | null) {
  if (!authHeader) {
    return { error: 'No authorization header', user: null };
  }
  
  const token = authHeader.split(' ')[1];
  if (!token) {
    return { error: 'Invalid authorization format', user: null };
  }

  try {
    // Use service role key client to verify the user token
    const { data: { user }, error } = await supabase.auth.getUser(token);
    
    if (error || !user) {
      console.log('Token verification failed:', error?.message || 'No user found');
      return { error: error?.message || 'Invalid token', user: null };
    }
    
    return { user, error: null };
  } catch (err) {
    console.log('Token verification exception:', err);
    return { error: 'Token verification failed', user: null };
  }
}

// ==================== AUTH ROUTES ====================

// Sign up route
app.post('/make-server-63060bc2/signup', async (c) => {
  try {
    const { email, password, name, role, permissions } = await c.req.json();

    if (!email || !password || !name || !role) {
      return c.json({ error: 'Email, password, name, and role are required' }, 400);
    }

    // Check if this is being called by an authenticated admin (for adding staff)
    // or if it's the first user signup (no auth required)
    const authHeader = c.req.header('Authorization');
    const staffList = (await kv.get('staff:list')) || [];
    const isFirstUser = staffList.length === 0;

    // If not the first user, verify permissions
    if (!isFirstUser) {
      const { user, error: authError } = await verifyUser(authHeader);
      
      if (authError || !user) {
        console.log('Add staff auth failed:', { authError, hasAuthHeader: !!authHeader });
        return c.json({ error: authError || 'Unauthorized - Authentication required to add staff' }, 401);
      }

      const currentStaffData = await kv.get(`staff:${user.id}`);
      
      if (!currentStaffData) {
        console.log('Staff data not found for user:', user.id);
        return c.json({ error: 'Staff record not found' }, 404);
      }
      
      if (!currentStaffData.permissions?.staffManagement?.add) {
        console.log('No permission to add staff:', { 
          userId: user.id,
          hasStaffManagementPermissions: !!currentStaffData.permissions?.staffManagement,
          canAdd: currentStaffData.permissions?.staffManagement?.add
        });
        return c.json({ error: 'No permission to add staff members' }, 403);
      }
    }

    // Create user in Supabase Auth
    // Note: email_confirm is now false since SMTP is configured
    // User will receive welcome email with login credentials
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // Set to true to auto-confirm, user will still receive welcome email
      user_metadata: { name, role },
    });

    if (error) {
      console.log(`Signup error for ${email}: ${error.message}`);
      return c.json({ error: error.message }, 400);
    }

    // Store staff data in KV store
    const staffId = data.user.id;
    
    // First user gets full permissions automatically, all others require manual assignment
    let userPermissions;
    if (isFirstUser) {
      userPermissions = getFullPermissions();
      console.log('First user signup - granting full permissions');
    } else {
      userPermissions = permissions || getEmptyPermissions();
    }
    
    const staffData = {
      id: staffId,
      name,
      email,
      role,
      permissions: userPermissions,
      status: 'active',
      createdAt: new Date().toISOString(),
    };

    await kv.set(`staff:${staffId}`, staffData);
    
    // Add to staff list
    const updatedStaffList = (await kv.get('staff:list')) || [];
    updatedStaffList.push(staffId);
    await kv.set('staff:list', updatedStaffList);

    // Log activity - use current user's info if authenticated, otherwise the new user
    if (!isFirstUser && authHeader) {
      const { user } = await verifyUser(authHeader);
      if (user) {
        const currentStaffData = await kv.get(`staff:${user.id}`);
        await addActivity(user.id, currentStaffData.name, 'add_staff', `Added new staff member: ${name}`, `Role: ${role}, Email: ${email}`, getClientIP(c.req));
      }
    } else {
      await addActivity(staffId, name, 'signup', `New user signed up: ${name}`, `Role: ${role}, Email: ${email}`, getClientIP(c.req));
    }

    // Send welcome email with credentials (only for staff added by admin, not first user)
    if (!isFirstUser) {
      try {
        // Store welcome email data in KV for reference
        await kv.set(`welcome:${staffId}`, {
          email,
          name,
          role,
          temporaryPassword: password,
          createdAt: new Date().toISOString(),
        });

        // Try to send welcome email via configured email service
        const emailSent = await sendEmail({
          to: email,
          subject: `Welcome to Fliptrade Group - Your Account is Ready! 🎉`,
          html: getWelcomeEmailHTML(name, email, password, 'https://admin.fliptradegroup.com'),
        });

        if (emailSent) {
          console.log(`✅ Welcome email sent successfully to ${email}`);
        } else {
          // Email not sent - log credentials for manual sharing
          console.log('='.repeat(60));
          console.log('⚠️  EMAIL NOT SENT - SHARE CREDENTIALS MANUALLY');
          console.log('='.repeat(60));
          console.log(`Name: ${name}`);
          console.log(`Email: ${email}`);
          console.log(`Role: ${role}`);
          console.log(`Temporary Password: ${password}`);
          console.log('='.repeat(60));
          console.log('NOTE: Set RESEND_API_KEY or SENDGRID_API_KEY to enable automatic emails.');
          console.log('='.repeat(60));
        }
        
      } catch (emailError) {
        console.log('Welcome email error (non-critical):', emailError);
        // Continue even if email fails - staff is already created
      }
    }

    return c.json({ 
      success: true, 
      user: { id: staffId, email, name, role },
      // Return credentials in response for admin to share
      credentials: !isFirstUser ? { email, temporaryPassword: password } : undefined
    });
  } catch (error) {
    console.log(`Signup server error: ${error}`);
    return c.json({ error: 'Signup failed' }, 500);
  }
});

// Login route (handled by Supabase client on frontend)
// No server route needed - frontend will use supabase.auth.signInWithPassword

// Get current user data
app.get('/make-server-63060bc2/user', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  let staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData) {
    return c.json({ error: 'ACCOUNT_DELETED', message: 'Your account has been deleted by the administrator. Please contact support for assistance.' }, 403);
  }

  // Check if user is deactivated
  if (staffData.status === 'inactive') {
    return c.json({ error: 'ACCOUNT_DEACTIVATED', message: 'Your account is temporarily deactivated by the administrator. Please contact support to reactivate your account.' }, 403);
  }

  // AUTO-FIX: Ensure permissions exist (fix for users created before permissions system)
  if (!staffData.permissions || Object.keys(staffData.permissions).length === 0) {
    console.log(`Auto-fixing missing permissions for user: ${staffData.email}`);
    
    // Check if this is the first/only user
    const staffList = (await kv.get('staff:list')) || [];
    const isFirstUser = staffList.length === 1 && staffList[0] === user.id;
    
    if (isFirstUser || staffData.role === 'Super Admin') {
      // First user or Super Admin gets full permissions
      staffData.permissions = getFullPermissions();
      console.log(`Granted full permissions to ${staffData.role}: ${staffData.email}`);
    } else if (staffData.role === 'Admin') {
      // Admin gets full permissions
      staffData.permissions = getFullPermissions();
      console.log(`Granted full permissions to Admin: ${staffData.email}`);
    } else {
      // Regular staff gets basic permissions
      staffData.permissions = {
        dashboard: { view: true, viewAll: false },
        deposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
        bankDeposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
        staffManagement: { view: false, add: false, edit: false, delete: false, archive: false, restore: false, viewAll: false },
        activityLogs: { view: true, viewAll: false },
        settings: { view: true, edit: false }
      };
      console.log(`Granted basic permissions to Staff: ${staffData.email}`);
    }
    
    // Save updated permissions
    await kv.set(`staff:${user.id}`, staffData);
  }

  // Update lastLogin timestamp
  const currentTime = new Date().toISOString();
  staffData.lastLogin = currentTime;

  // Save updated staff data with lastLogin
  await kv.set(`staff:${user.id}`, staffData);

  return c.json({ user: staffData });
});

// Change password route
app.post('/make-server-63060bc2/change-password', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  try {
    const { currentPassword, newPassword } = await c.req.json();

    if (!currentPassword || !newPassword) {
      return c.json({ error: 'Current password and new password are required' }, 400);
    }

    if (newPassword.length < 6) {
      return c.json({ error: 'New password must be at least 6 characters long' }, 400);
    }

    // Get staff data
    const staffData = await kv.get(`staff:${user.id}`);
    if (!staffData) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Verify current password by trying to sign in
    const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
      email: staffData.email,
      password: currentPassword,
    });

    if (signInError || !signInData.user) {
      console.log('Current password verification failed:', signInError?.message);
      return c.json({ error: 'Current password is incorrect' }, 400);
    }

    // Update password using admin API
    const { data: updateData, error: updateError } = await supabase.auth.admin.updateUserById(
      user.id,
      { password: newPassword }
    );

    if (updateError) {
      console.log('Password update failed:', updateError.message);
      return c.json({ error: 'Failed to update password: ' + updateError.message }, 500);
    }

    // Log activity
    await addActivity(user.id, staffData.name, 'change_password', 'Changed password', 'Password updated successfully', getClientIP(c.req));

    return c.json({ success: true, message: 'Password changed successfully' });
  } catch (error) {
    console.log('Change password server error:', error);
    return c.json({ error: 'Failed to change password' }, 500);
  }
});

// ==================== FORGOT PASSWORD WITH OTP ====================

// Helper function to generate 6-digit OTP
function generateOTP(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

// Send OTP for password reset
app.post('/make-server-63060bc2/forgot-password/send-otp', async (c) => {
  try {
    const { email } = await c.req.json();

    if (!email) {
      return c.json({ error: 'Email is required' }, 400);
    }

    // Check if user exists in staff list
    const staffList = (await kv.get('staff:list')) || [];
    let userExists = false;
    let userName = '';

    for (const staffId of staffList) {
      const staffData = await kv.get(`staff:${staffId}`);
      if (staffData && staffData.email === email) {
        userExists = true;
        userName = staffData.name;
        break;
      }
    }

    if (!userExists) {
      return c.json({ error: 'No account found with this email address' }, 404);
    }

    // Generate OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString(); // 5 minutes expiry

    // Store OTP in KV store
    await kv.set(`otp:${email}`, {
      otp,
      email,
      expiresAt,
      attempts: 0,
      createdAt: new Date().toISOString(),
    });

    // Send OTP via Supabase Auth (using password reset email as workaround)
    // Note: This will send a password reset link, but we'll show OTP in the email
    // For production, you should use a proper email service like SendGrid or Resend
    
    console.log(`OTP generated for ${email}: ${otp} (expires at ${expiresAt})`);
    console.log(`Welcome ${userName}! Your OTP for password reset is: ${otp}`);

    // Send OTP email via configured email service
    const emailSent = await sendEmail({
      to: email,
      subject: `Password Reset Code - Fliptrade Group 🔐`,
      html: getOTPEmailHTML(userName, otp),
    });

    if (emailSent) {
      console.log(`✅ OTP email sent successfully to ${email}`);
      return c.json({ 
        success: true, 
        message: 'OTP sent to your email address. Please check your inbox.'
      });
    } else {
      // Email not sent - return OTP in response for development
      console.log(`⚠️  Email service not configured - returning OTP in response`);
      return c.json({ 
        success: true, 
        message: 'OTP generated (email service not configured)',
        // Include OTP in response if email fails (development only)
        debug_otp: otp 
      });
    }
  } catch (error) {
    console.log('Send OTP error:', error);
    return c.json({ error: 'Failed to send OTP' }, 500);
  }
});

// Verify OTP and reset password
app.post('/make-server-63060bc2/forgot-password/verify-otp', async (c) => {
  try {
    const { email, otp, newPassword } = await c.req.json();

    if (!email || !otp || !newPassword) {
      return c.json({ error: 'Email, OTP, and new password are required' }, 400);
    }

    if (newPassword.length < 6) {
      return c.json({ error: 'Password must be at least 6 characters long' }, 400);
    }

    // Get stored OTP
    const otpData = await kv.get(`otp:${email}`);

    if (!otpData) {
      return c.json({ error: 'OTP not found or expired. Please request a new OTP.' }, 400);
    }

    // Check if OTP expired
    if (new Date() > new Date(otpData.expiresAt)) {
      await kv.del(`otp:${email}`);
      return c.json({ error: 'OTP has expired. Please request a new OTP.' }, 400);
    }

    // Check attempts limit
    if (otpData.attempts >= 3) {
      await kv.del(`otp:${email}`);
      return c.json({ error: 'Too many incorrect attempts. Please request a new OTP.' }, 400);
    }

    // Verify OTP
    if (otpData.otp !== otp) {
      otpData.attempts += 1;
      await kv.set(`otp:${email}`, otpData);
      return c.json({ 
        error: 'Invalid OTP. Please try again.',
        remainingAttempts: 3 - otpData.attempts 
      }, 400);
    }

    // Find user in staff list
    const staffList = (await kv.get('staff:list')) || [];
    let userId = null;

    for (const staffId of staffList) {
      const staffData = await kv.get(`staff:${staffId}`);
      if (staffData && staffData.email === email) {
        userId = staffId;
        break;
      }
    }

    if (!userId) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Update password in Supabase Auth
    const { error: updateError } = await supabase.auth.admin.updateUserById(
      userId,
      { password: newPassword }
    );

    if (updateError) {
      console.log(`Password reset error for ${email}:`, updateError.message);
      return c.json({ error: 'Failed to reset password' }, 500);
    }

    // Delete OTP after successful reset
    await kv.del(`otp:${email}`);

    // Log activity
    const staffData = await kv.get(`staff:${userId}`);
    await addActivity(userId, staffData.name, 'password_reset', 'Password reset via OTP', `Email: ${email}`, getClientIP(c.req));

    return c.json({ 
      success: true, 
      message: 'Password reset successfully! Please login with your new password.' 
    });
  } catch (error) {
    console.log('Verify OTP error:', error);
    return c.json({ error: 'Failed to verify OTP' }, 500);
  }
});

// Update own profile (name only - email changes must be done by admin)
app.put('/make-server-63060bc2/profile', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  try {
    const { name } = await c.req.json();

    if (!name || name.trim().length === 0) {
      return c.json({ error: 'Name is required' }, 400);
    }

    // Get staff data
    const staffData = await kv.get(`staff:${user.id}`);
    if (!staffData) {
      return c.json({ error: 'User not found' }, 404);
    }

    // Update staff data
    const updatedStaffData = {
      ...staffData,
      name: name.trim(),
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`staff:${user.id}`, updatedStaffData);

    // Log activity
    await addActivity(user.id, name, 'update_profile', 'Updated own profile', `Changed name to: ${name}`, getClientIP(c.req));

    return c.json({ success: true, user: updatedStaffData });
  } catch (error) {
    console.log('Profile update server error:', error);
    return c.json({ error: 'Failed to update profile' }, 500);
  }
});

// ==================== DEPOSITS ROUTES ====================

// Get all deposits with optional search, filters, and pagination
app.get('/make-server-63060bc2/deposits', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  let staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData) {
    return c.json({ error: 'User not found' }, 404);
  }

  // AUTO-FIX: Ensure permissions exist
  if (!staffData.permissions || Object.keys(staffData.permissions).length === 0) {
    const staffList = (await kv.get('staff:list')) || [];
    const isFirstUser = staffList.length === 1 && staffList[0] === user.id;
    
    if (isFirstUser || staffData.role === 'Super Admin' || staffData.role === 'Admin') {
      staffData.permissions = getFullPermissions();
    } else {
      staffData.permissions = {
        dashboard: { view: true, viewAll: false },
        deposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
        bankDeposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
        staffManagement: { view: false, add: false, edit: false, delete: false, archive: false, restore: false, viewAll: false },
        activityLogs: { view: true, viewAll: false },
        settings: { view: true, edit: false }
      };
    }
    await kv.set(`staff:${user.id}`, staffData);
  }

  // Get query parameters
  const searchTerm = c.req.query('search')?.toLowerCase() || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '1000');
  const dateFrom = c.req.query('dateFrom') || '';
  const dateTo = c.req.query('dateTo') || '';
  const submittedBy = c.req.query('submittedBy') || '';

  const depositIds = (await kv.get('deposits:list')) || [];
  let deposits = await kv.mget(depositIds.map((id: string) => `deposit:${id}`));
  deposits = deposits.filter(Boolean);

  // Filter based on role - Staff users only see their own deposits
  if (staffData.role !== 'Admin' && staffData.role !== 'Super Admin') {
    deposits = deposits.filter((d: any) => d.submittedBy === user.id);
  }

  // Apply filters
  let filteredDeposits = deposits;

  // Search filter (search in date, submitter name, or amounts)
  if (searchTerm) {
    filteredDeposits = filteredDeposits.filter((deposit: any) => {
      return (
        deposit.date?.toLowerCase().includes(searchTerm) ||
        deposit.submittedByName?.toLowerCase().includes(searchTerm) ||
        deposit.localDeposit?.toString().includes(searchTerm) ||
        deposit.usdtDeposit?.toString().includes(searchTerm) ||
        deposit.cashDeposit?.toString().includes(searchTerm)
      );
    });
  }

  // Date range filter
  if (dateFrom) {
    filteredDeposits = filteredDeposits.filter((deposit: any) => deposit.date >= dateFrom);
  }
  if (dateTo) {
    filteredDeposits = filteredDeposits.filter((deposit: any) => deposit.date <= dateTo);
  }

  // Submitted by filter (for admins)
  if (submittedBy && (staffData.role === 'Admin' || staffData.role === 'Super Admin')) {
    filteredDeposits = filteredDeposits.filter((deposit: any) => deposit.submittedBy === submittedBy);
  }

  // Sort by date (newest first)
  filteredDeposits.sort((a: any, b: any) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  // Calculate pagination
  const totalCount = filteredDeposits.length;
  const totalPages = Math.ceil(totalCount / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;

  // Apply pagination
  const paginatedDeposits = limit < 1000 ? filteredDeposits.slice(startIndex, endIndex) : filteredDeposits;

  return c.json({ 
    deposits: paginatedDeposits,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    }
  });
});

// Create deposit
app.post('/make-server-63060bc2/deposits', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData || !staffData.permissions?.deposits?.add) {
    return c.json({ error: 'No permission to add deposits' }, 403);
  }

  try {
    const depositData = await c.req.json();
    const depositId = `${Date.now()}_${user.id}`;
    
    // Check if admin is submitting on behalf of another staff member
    let submittedBy = user.id;
    let submittedByName = staffData.name;
    
    // If submittedBy and submittedByName are provided in the request, use them (for "on behalf of" functionality)
    if (depositData.submittedBy && depositData.submittedByName) {
      // Verify that the current user is an admin
      const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
      if (isAdmin) {
        // Verify that the submittedBy ID exists in staff
        const targetStaffData = await kv.get(`staff:${depositData.submittedBy}`);
        if (targetStaffData) {
          submittedBy = depositData.submittedBy;
          submittedByName = depositData.submittedByName;
        }
      }
    }
    
    const deposit = {
      ...depositData,
      id: depositId,
      submittedBy: submittedBy,
      submittedByName: submittedByName,
      createdAt: new Date().toISOString(),
    };

    await kv.set(`deposit:${depositId}`, deposit);
    
    // Add to deposits list
    const depositsList = (await kv.get('deposits:list')) || [];
    depositsList.push(depositId);
    await kv.set('deposits:list', depositsList);

    // Log activity
    await addActivity(user.id, staffData.name, 'add_deposit', 'Added new deposit entry', `Date: ${deposit.date}`, getClientIP(c.req));

    return c.json({ success: true, deposit });
  } catch (error) {
    console.log(`Create deposit error: ${error}`);
    return c.json({ error: 'Failed to create deposit' }, 500);
  }
});

// Update deposit
app.put('/make-server-63060bc2/deposits/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  const depositId = c.req.param('id');
  const existingDeposit = await kv.get(`deposit:${depositId}`);

  if (!existingDeposit) {
    return c.json({ error: 'Deposit not found' }, 404);
  }

  // Check permissions
  const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
  const isOwner = existingDeposit.submittedBy === user.id;
  
  if (!staffData.permissions?.deposits?.edit || (!isAdmin && !isOwner)) {
    return c.json({ error: 'No permission to edit this deposit' }, 403);
  }

  try {
    const updateData = await c.req.json();
    
    // Determine submittedBy and submittedByName
    let submittedBy = existingDeposit.submittedBy;
    let submittedByName = existingDeposit.submittedByName;
    
    // If admin is updating and wants to change who submitted it (on behalf of)
    if (updateData.submittedBy && updateData.submittedByName && isAdmin) {
      // Verify that the submittedBy ID exists in staff
      const targetStaffData = await kv.get(`staff:${updateData.submittedBy}`);
      if (targetStaffData) {
        submittedBy = updateData.submittedBy;
        submittedByName = updateData.submittedByName;
      }
    }
    
    const updatedDeposit = {
      ...existingDeposit,
      ...updateData,
      id: depositId,
      submittedBy: submittedBy,
      submittedByName: submittedByName,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`deposit:${depositId}`, updatedDeposit);

    // Log activity
    await addActivity(user.id, staffData.name, 'edit_deposit', 'Updated deposit entry', `Date: ${updatedDeposit.date}`, getClientIP(c.req));

    return c.json({ success: true, deposit: updatedDeposit });
  } catch (error) {
    console.log(`Update deposit error: ${error}`);
    return c.json({ error: 'Failed to update deposit' }, 500);
  }
});

// Delete deposit
app.delete('/make-server-63060bc2/deposits/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  const depositId = c.req.param('id');
  const existingDeposit = await kv.get(`deposit:${depositId}`);

  if (!existingDeposit) {
    return c.json({ error: 'Deposit not found' }, 404);
  }

  // Check permissions
  const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
  const isOwner = existingDeposit.submittedBy === user.id;
  
  if (!staffData.permissions?.deposits?.delete || (!isAdmin && !isOwner)) {
    return c.json({ error: 'No permission to delete this deposit' }, 403);
  }

  try {
    await kv.del(`deposit:${depositId}`);
    
    // Remove from deposits list
    const depositsList = (await kv.get('deposits:list')) || [];
    const updatedList = depositsList.filter((id: string) => id !== depositId);
    await kv.set('deposits:list', updatedList);

    // Log activity
    await addActivity(user.id, staffData.name, 'delete_deposit', 'Deleted deposit entry', `Date: ${existingDeposit.date}`, getClientIP(c.req));

    return c.json({ success: true });
  } catch (error) {
    console.log(`Delete deposit error: ${error}`);
    return c.json({ error: 'Failed to delete deposit' }, 500);
  }
});

// ==================== BANK DEPOSITS ROUTES ====================

// Get all bank deposits with optional search, filters, and pagination
app.get('/make-server-63060bc2/bank-deposits', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  let staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData) {
    return c.json({ error: 'User not found' }, 404);
  }

  // AUTO-FIX: Ensure permissions exist
  if (!staffData.permissions || Object.keys(staffData.permissions).length === 0) {
    const staffList = (await kv.get('staff:list')) || [];
    const isFirstUser = staffList.length === 1 && staffList[0] === user.id;
    
    if (isFirstUser || staffData.role === 'Super Admin' || staffData.role === 'Admin') {
      staffData.permissions = getFullPermissions();
    } else {
      staffData.permissions = {
        dashboard: { view: true, viewAll: false },
        deposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
        bankDeposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
        staffManagement: { view: false, add: false, edit: false, delete: false, archive: false, restore: false, viewAll: false },
        activityLogs: { view: true, viewAll: false },
        settings: { view: true, edit: false }
      };
    }
    await kv.set(`staff:${user.id}`, staffData);
  }

  // Get query parameters
  const searchTerm = c.req.query('search')?.toLowerCase() || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '1000');
  const dateFrom = c.req.query('dateFrom') || '';
  const dateTo = c.req.query('dateTo') || '';
  const submittedBy = c.req.query('submittedBy') || '';
  const accountType = c.req.query('accountType') || '';

  const bankDepositIds = (await kv.get('bankDeposits:list')) || [];
  let bankDeposits = await kv.mget(bankDepositIds.map((id: string) => `bankDeposit:${id}`));
  bankDeposits = bankDeposits.filter(Boolean);

  // Filter based on role - Staff users only see their own deposits
  if (staffData.role !== 'Admin' && staffData.role !== 'Super Admin') {
    bankDeposits = bankDeposits.filter((d: any) => d.submittedBy === user.id);
  }

  // Apply filters
  let filteredBankDeposits = bankDeposits;

  // Search filter (search in date, submitter name, bank name, account type, or amounts)
  if (searchTerm) {
    filteredBankDeposits = filteredBankDeposits.filter((deposit: any) => {
      return (
        deposit.date?.toLowerCase().includes(searchTerm) ||
        deposit.submittedByName?.toLowerCase().includes(searchTerm) ||
        deposit.bankName?.toLowerCase().includes(searchTerm) ||
        deposit.accountType?.toLowerCase().includes(searchTerm) ||
        deposit.depositAmount?.toString().includes(searchTerm) ||
        deposit.withdrawalAmount?.toString().includes(searchTerm)
      );
    });
  }

  // Date range filter
  if (dateFrom) {
    filteredBankDeposits = filteredBankDeposits.filter((deposit: any) => deposit.date >= dateFrom);
  }
  if (dateTo) {
    filteredBankDeposits = filteredBankDeposits.filter((deposit: any) => deposit.date <= dateTo);
  }

  // Submitted by filter (for admins)
  if (submittedBy && (staffData.role === 'Admin' || staffData.role === 'Super Admin')) {
    filteredBankDeposits = filteredBankDeposits.filter((deposit: any) => deposit.submittedBy === submittedBy);
  }

  // Account type filter
  if (accountType && accountType !== 'all') {
    filteredBankDeposits = filteredBankDeposits.filter((deposit: any) => deposit.accountType === accountType);
  }

  // Sort by date (newest first)
  filteredBankDeposits.sort((a: any, b: any) => {
    const dateA = new Date(a.date || 0).getTime();
    const dateB = new Date(b.date || 0).getTime();
    return dateB - dateA;
  });

  // Calculate pagination
  const totalCount = filteredBankDeposits.length;
  const totalPages = Math.ceil(totalCount / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;

  // Apply pagination
  const paginatedBankDeposits = limit < 1000 ? filteredBankDeposits.slice(startIndex, endIndex) : filteredBankDeposits;

  return c.json({ 
    bankDeposits: paginatedBankDeposits,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    }
  });
});

// Create bank deposit
app.post('/make-server-63060bc2/bank-deposits', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData || !staffData.permissions?.bankDeposits?.add) {
    return c.json({ error: 'No permission to add bank deposits' }, 403);
  }

  try {
    const bankDepositData = await c.req.json();
    const bankDepositId = `${Date.now()}_${user.id}`;
    
    // Check if admin is submitting on behalf of another staff member
    let submittedBy = user.id;
    let submittedByName = staffData.name;
    
    // If submittedBy and submittedByName are provided in the request, use them (for "on behalf of" functionality)
    if (bankDepositData.submittedBy && bankDepositData.submittedByName) {
      // Verify that the current user is an admin
      const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
      if (isAdmin) {
        // Verify that the submittedBy ID exists in staff
        const targetStaffData = await kv.get(`staff:${bankDepositData.submittedBy}`);
        if (targetStaffData) {
          submittedBy = bankDepositData.submittedBy;
          submittedByName = bankDepositData.submittedByName;
        }
      }
    }
    
    const bankDeposit = {
      ...bankDepositData,
      id: bankDepositId,
      submittedBy: submittedBy,
      submittedByName: submittedByName,
      createdAt: new Date().toISOString(),
    };

    await kv.set(`bankDeposit:${bankDepositId}`, bankDeposit);
    
    // Add to bank deposits list
    const bankDepositsList = (await kv.get('bankDeposits:list')) || [];
    bankDepositsList.push(bankDepositId);
    await kv.set('bankDeposits:list', bankDepositsList);

    // Log activity
    await addActivity(user.id, staffData.name, 'add_bank_deposit', 'Added new bank deposit', `Amount: $${bankDeposit.amount}`, getClientIP(c.req));

    return c.json({ success: true, bankDeposit });
  } catch (error) {
    console.log(`Create bank deposit error: ${error}`);
    return c.json({ error: 'Failed to create bank deposit' }, 500);
  }
});

// Update bank deposit
app.put('/make-server-63060bc2/bank-deposits/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  const bankDepositId = c.req.param('id');
  const existingBankDeposit = await kv.get(`bankDeposit:${bankDepositId}`);

  if (!existingBankDeposit) {
    return c.json({ error: 'Bank deposit not found' }, 404);
  }

  // Check permissions
  const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
  const isOwner = existingBankDeposit.submittedBy === user.id;
  
  if (!staffData.permissions?.bankDeposits?.edit || (!isAdmin && !isOwner)) {
    return c.json({ error: 'No permission to edit this bank deposit' }, 403);
  }

  try {
    const updateData = await c.req.json();
    
    // Determine submittedBy and submittedByName
    let submittedBy = existingBankDeposit.submittedBy;
    let submittedByName = existingBankDeposit.submittedByName;
    
    // If admin is updating and wants to change who submitted it (on behalf of)
    if (updateData.submittedBy && updateData.submittedByName && isAdmin) {
      // Verify that the submittedBy ID exists in staff
      const targetStaffData = await kv.get(`staff:${updateData.submittedBy}`);
      if (targetStaffData) {
        submittedBy = updateData.submittedBy;
        submittedByName = updateData.submittedByName;
      }
    }
    
    const updatedBankDeposit = {
      ...existingBankDeposit,
      ...updateData,
      id: bankDepositId,
      submittedBy: submittedBy,
      submittedByName: submittedByName,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`bankDeposit:${bankDepositId}`, updatedBankDeposit);

    // Log activity
    await addActivity(user.id, staffData.name, 'edit_bank_deposit', 'Updated bank deposit', `Amount: $${updatedBankDeposit.amount}`, getClientIP(c.req));

    return c.json({ success: true, bankDeposit: updatedBankDeposit });
  } catch (error) {
    console.log(`Update bank deposit error: ${error}`);
    return c.json({ error: 'Failed to update bank deposit' }, 500);
  }
});

// Delete bank deposit
app.delete('/make-server-63060bc2/bank-deposits/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  const bankDepositId = c.req.param('id');
  const existingBankDeposit = await kv.get(`bankDeposit:${bankDepositId}`);

  if (!existingBankDeposit) {
    return c.json({ error: 'Bank deposit not found' }, 404);
  }

  // Check permissions
  const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
  const isOwner = existingBankDeposit.submittedBy === user.id;
  
  if (!staffData.permissions?.bankDeposits?.delete || (!isAdmin && !isOwner)) {
    return c.json({ error: 'No permission to delete this bank deposit' }, 403);
  }

  try {
    await kv.del(`bankDeposit:${bankDepositId}`);
    
    // Remove from bank deposits list
    const bankDepositsList = (await kv.get('bankDeposits:list')) || [];
    const updatedList = bankDepositsList.filter((id: string) => id !== bankDepositId);
    await kv.set('bankDeposits:list', updatedList);

    // Log activity
    await addActivity(user.id, staffData.name, 'delete_bank_deposit', 'Deleted bank deposit', `Amount: $${existingBankDeposit.amount}`, getClientIP(c.req));

    return c.json({ success: true });
  } catch (error) {
    console.log(`Delete bank deposit error: ${error}`);
    return c.json({ error: 'Failed to delete bank deposit' }, 500);
  }
});

// ==================== STAFF ROUTES ====================

// Get all staff with optional search and pagination
app.get('/make-server-63060bc2/staff', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  let staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData) {
    return c.json({ error: 'Staff not found' }, 404);
  }

  // AUTO-FIX: Ensure permissions exist
  if (!staffData.permissions || Object.keys(staffData.permissions).length === 0) {
    console.log(`Auto-fixing missing permissions for user in staff endpoint: ${staffData.email}`);
    
    const staffList = (await kv.get('staff:list')) || [];
    const isFirstUser = staffList.length === 1 && staffList[0] === user.id;
    
    if (isFirstUser || staffData.role === 'Super Admin' || staffData.role === 'Admin') {
      staffData.permissions = getFullPermissions();
    } else {
      staffData.permissions = {
        dashboard: { view: true, viewAll: false },
        deposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
        bankDeposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
        staffManagement: { view: false, add: false, edit: false, delete: false, archive: false, restore: false, viewAll: false },
        activityLogs: { view: true, viewAll: false },
        settings: { view: true, edit: false }
      };
    }
    await kv.set(`staff:${user.id}`, staffData);
  }
  
  if (!staffData.permissions?.staffManagement?.view) {
    return c.json({ error: 'No permission to view staff' }, 403);
  }

  // Get query parameters for search and pagination
  const searchTerm = c.req.query('search')?.toLowerCase() || '';
  const page = parseInt(c.req.query('page') || '1');
  const limit = parseInt(c.req.query('limit') || '1000'); // Default: return all if no limit
  const role = c.req.query('role') || '';
  const status = c.req.query('status') || '';
  const archived = c.req.query('archived') || '';

  const staffIds = (await kv.get('staff:list')) || [];
  let staff = await kv.mget(staffIds.map((id: string) => `staff:${id}`));
  staff = staff.filter(Boolean);

  // Apply filters
  let filteredStaff = staff;

  // Search filter
  if (searchTerm) {
    filteredStaff = filteredStaff.filter((member: any) => {
      return (
        member.name?.toLowerCase().includes(searchTerm) ||
        member.email?.toLowerCase().includes(searchTerm) ||
        member.role?.toLowerCase().includes(searchTerm)
      );
    });
  }

  // Role filter
  if (role && role !== 'all') {
    filteredStaff = filteredStaff.filter((member: any) => member.role === role);
  }

  // Status filter
  if (status && status !== 'all') {
    filteredStaff = filteredStaff.filter((member: any) => member.status === status);
  }

  // Archived filter
  if (archived === 'true') {
    filteredStaff = filteredStaff.filter((member: any) => member.isArchived === true);
  } else if (archived === 'false') {
    filteredStaff = filteredStaff.filter((member: any) => member.isArchived !== true);
  }

  // Sort by createdAt (newest first)
  filteredStaff.sort((a: any, b: any) => {
    const dateA = new Date(a.createdAt || 0).getTime();
    const dateB = new Date(b.createdAt || 0).getTime();
    return dateB - dateA;
  });

  // Calculate pagination
  const totalCount = filteredStaff.length;
  const totalPages = Math.ceil(totalCount / limit);
  const startIndex = (page - 1) * limit;
  const endIndex = startIndex + limit;

  // Apply pagination
  const paginatedStaff = limit < 1000 ? filteredStaff.slice(startIndex, endIndex) : filteredStaff;

  return c.json({ 
    staff: paginatedStaff,
    pagination: {
      page,
      limit,
      totalCount,
      totalPages,
      hasNextPage: page < totalPages,
      hasPreviousPage: page > 1,
    }
  });
});

// Update staff
app.put('/make-server-63060bc2/staff/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const currentStaffData = await kv.get(`staff:${user.id}`);
  
  if (!currentStaffData || !currentStaffData.permissions?.staffManagement?.edit) {
    return c.json({ error: 'No permission to edit staff' }, 403);
  }

  const staffId = c.req.param('id');
  
  // Prevent users from editing their own permissions or role to avoid privilege escalation
  if (staffId === user.id) {
    return c.json({ error: 'Cannot edit your own account. Ask another admin for assistance.' }, 400);
  }

  const existingStaff = await kv.get(`staff:${staffId}`);

  if (!existingStaff) {
    return c.json({ error: 'Staff member not found' }, 404);
  }

  try {
    const updateData = await c.req.json();
    
    // Additional security: Only Admin can change email addresses
    if (updateData.email && updateData.email !== existingStaff.email) {
      if (currentStaffData.role !== 'Admin' && currentStaffData.role !== 'Super Admin') {
        return c.json({ error: 'Only Admin can change email addresses' }, 403);
      }
    }
    
    const updatedStaff = {
      ...existingStaff,
      ...updateData,
      id: staffId,
      updatedAt: new Date().toISOString(),
    };

    await kv.set(`staff:${staffId}`, updatedStaff);

    // Log activity
    await addActivity(user.id, currentStaffData.name, 'edit_staff', `Updated staff member: ${updatedStaff.name}`, `Role: ${updatedStaff.role}`, getClientIP(c.req));

    return c.json({ success: true, staff: updatedStaff });
  } catch (error) {
    console.log(`Update staff error: ${error}`);
    return c.json({ error: 'Failed to update staff' }, 500);
  }
});

// Delete staff
app.delete('/make-server-63060bc2/staff/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const currentStaffData = await kv.get(`staff:${user.id}`);
  
  if (!currentStaffData || !currentStaffData.permissions?.staffManagement?.delete) {
    return c.json({ error: 'No permission to delete staff' }, 403);
  }

  const staffId = c.req.param('id');
  
  // Cannot delete yourself
  if (staffId === user.id) {
    return c.json({ error: 'Cannot delete your own account' }, 400);
  }

  const existingStaff = await kv.get(`staff:${staffId}`);

  if (!existingStaff) {
    return c.json({ error: 'Staff member not found' }, 404);
  }

  try {
    await kv.del(`staff:${staffId}`);
    
    // Remove from staff list
    const staffList = (await kv.get('staff:list')) || [];
    const updatedList = staffList.filter((id: string) => id !== staffId);
    await kv.set('staff:list', updatedList);

    // Log activity
    await addActivity(user.id, currentStaffData.name, 'delete_staff', `Deleted staff member: ${existingStaff.name}`, `Role: ${existingStaff.role}`, getClientIP(c.req));

    return c.json({ success: true });
  } catch (error) {
    console.log(`Delete staff error: ${error}`);
    return c.json({ error: 'Failed to delete staff' }, 500);
  }
});

// ==================== ACTIVITIES ROUTES ====================

// Get all activities
app.get('/make-server-63060bc2/activities', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData) {
    return c.json({ error: 'User not found' }, 404);
  }

  const activityIds = (await kv.get('activities:list')) || [];
  const activities = await kv.mget(activityIds.map((id: string) => `activity:${id}`));

  // Filter based on role
  let filteredActivities = activities.filter(Boolean);
  
  if (staffData.role !== 'Admin' && staffData.role !== 'Super Admin') {
    filteredActivities = filteredActivities.filter((a: any) => a.userId === user.id);
  }

  // Sort by timestamp descending
  filteredActivities.sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  return c.json({ activities: filteredActivities });
});

// Delete activity log
app.delete('/make-server-63060bc2/activities/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  // Only Super Admin can delete activity logs
  if (!staffData || staffData.role !== 'Super Admin') {
    return c.json({ error: 'Only Super Admin can delete activity logs' }, 403);
  }

  try {
    const activityId = c.req.param('id');
    
    // Delete activity
    await kv.del(`activity:${activityId}`);
    
    // Remove from activities list
    const activityIds = (await kv.get('activities:list')) || [];
    const updatedList = activityIds.filter((id: string) => id !== activityId);
    await kv.set('activities:list', updatedList);

    // Log this deletion activity
    await addActivity(user.id, staffData.name, 'delete_activity', `Deleted activity log`, `Activity ID: ${activityId}`, getClientIP(c.req));

    return c.json({ success: true });
  } catch (error) {
    console.log(`Delete activity error: ${error}`);
    return c.json({ error: 'Failed to delete activity' }, 500);
  }
});

// Bulk delete activities (for cleanup)
app.post('/make-server-63060bc2/activities/bulk-delete', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  // Only Super Admin can bulk delete
  if (!staffData || staffData.role !== 'Super Admin') {
    return c.json({ error: 'Only Super Admin can bulk delete activities' }, 403);
  }

  try {
    const { activityIds } = await c.req.json();

    if (!activityIds || !Array.isArray(activityIds) || activityIds.length === 0) {
      return c.json({ error: 'Activity IDs array is required' }, 400);
    }

    // Delete activities
    await kv.mdel(activityIds.map((id: string) => `activity:${id}`));
    
    // Update activities list
    const allActivityIds = (await kv.get('activities:list')) || [];
    const updatedList = allActivityIds.filter((id: string) => !activityIds.includes(id));
    await kv.set('activities:list', updatedList);

    // Log this action
    await addActivity(user.id, staffData.name, 'bulk_delete_activities', `Bulk deleted ${activityIds.length} activity logs`, '', getClientIP(c.req));

    return c.json({ success: true, deletedCount: activityIds.length });
  } catch (error) {
    console.log(`Bulk delete activities error: ${error}`);
    return c.json({ error: 'Failed to bulk delete activities' }, 500);
  }
});

// ==================== ROLES API ====================

// Get all roles
app.get('/make-server-63060bc2/roles', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData || !staffData.permissions?.staffManagement?.view) {
    return c.json({ error: 'No permission to view roles' }, 403);
  }

  try {
    const roles = (await kv.get('roles:list')) || [];
    return c.json({ success: true, roles });
  } catch (error) {
    console.log(`Get roles error: ${error}`);
    return c.json({ error: 'Failed to fetch roles' }, 500);
  }
});

// Add new role
app.post('/make-server-63060bc2/roles', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData || !staffData.permissions?.staffManagement?.add) {
    return c.json({ error: 'No permission to add roles' }, 403);
  }

  try {
    const { roleName } = await c.req.json();

    if (!roleName) {
      return c.json({ error: 'Role name is required' }, 400);
    }

    // Check if role already exists
    const rolesList = (await kv.get('roles:list')) || [];
    const existingRole = rolesList.find((r: any) => r.name.toLowerCase() === roleName.toLowerCase());
    
    if (existingRole) {
      return c.json({ error: 'Role with this name already exists' }, 400);
    }

    const roleId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newRole = {
      id: roleId,
      name: roleName,
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      createdByName: staffData.name,
    };

    // Add role to list
    rolesList.push(newRole);
    await kv.set('roles:list', rolesList);

    // Log activity
    await addActivity(user.id, staffData.name, 'add_role', `Created new role: ${roleName}`, '', getClientIP(c.req));

    return c.json({ success: true, role: newRole });
  } catch (error) {
    console.log(`Add role error: ${error}`);
    return c.json({ error: 'Failed to add role' }, 500);
  }
});

// Update role
app.put('/make-server-63060bc2/roles/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData || !staffData.permissions?.staffManagement?.edit) {
    return c.json({ error: 'No permission to edit roles' }, 403);
  }

  try {
    const roleId = c.req.param('id');
    const { roleName } = await c.req.json();

    if (!roleName || !roleName.trim()) {
      return c.json({ error: 'Role name is required' }, 400);
    }

    const rolesList = (await kv.get('roles:list')) || [];
    const roleIndex = rolesList.findIndex((r: any) => r.id === roleId);
    
    if (roleIndex === -1) {
      return c.json({ error: 'Role not found' }, 404);
    }

    // Check if new name conflicts with existing roles
    const existingRole = rolesList.find((r: any) => 
      r.id !== roleId && r.name.toLowerCase() === roleName.trim().toLowerCase()
    );
    
    if (existingRole) {
      return c.json({ error: 'Role with this name already exists' }, 400);
    }

    const oldName = rolesList[roleIndex].name;

    // Update role
    rolesList[roleIndex] = {
      ...rolesList[roleIndex],
      name: roleName.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      updatedByName: staffData.name,
    };

    await kv.set('roles:list', rolesList);

    // Update all staff members who have this role
    const staffList = (await kv.get('staff:list')) || [];
    for (const staffId of staffList) {
      const staff = await kv.get(`staff:${staffId}`);
      if (staff && staff.role === oldName) {
        staff.role = roleName.trim();
        await kv.set(`staff:${staffId}`, staff);
      }
    }

    // Log activity
    await addActivity(user.id, staffData.name, 'edit_role', `Updated role: ${oldName} → ${roleName}`, '', getClientIP(c.req));

    return c.json({ success: true, role: rolesList[roleIndex] });
  } catch (error) {
    console.log(`Update role error: ${error}`);
    return c.json({ error: 'Failed to update role' }, 500);
  }
});

// Delete role
app.delete('/make-server-63060bc2/roles/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData || !staffData.permissions?.staffManagement?.delete) {
    return c.json({ error: 'No permission to delete roles' }, 403);
  }

  try {
    const roleId = c.req.param('id');
    const rolesList = (await kv.get('roles:list')) || [];
    
    const roleIndex = rolesList.findIndex((r: any) => r.id === roleId);
    
    if (roleIndex === -1) {
      return c.json({ error: 'Role not found' }, 404);
    }

    const roleName = rolesList[roleIndex].name;

    // Check if any staff members are using this role
    const staffList = (await kv.get('staff:list')) || [];
    let hasAssignedStaff = false;
    
    for (const staffId of staffList) {
      const staff = await kv.get(`staff:${staffId}`);
      if (staff && staff.role === roleName) {
        hasAssignedStaff = true;
        break;
      }
    }

    if (hasAssignedStaff) {
      return c.json({ error: 'Cannot delete role that is assigned to staff members' }, 400);
    }

    // Remove role from list
    rolesList.splice(roleIndex, 1);
    await kv.set('roles:list', rolesList);

    // Log activity
    await addActivity(user.id, staffData.name, 'delete_role', `Deleted role: ${roleName}`, '', getClientIP(c.req));

    return c.json({ success: true });
  } catch (error) {
    console.log(`Delete role error: ${error}`);
    return c.json({ error: 'Failed to delete role' }, 500);
  }
});

// Refresh all users' permissions (utility endpoint for migrations)
app.post('/make-server-63060bc2/refresh-permissions', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const currentStaffData = await kv.get(`staff:${user.id}`);
  
  // Only Super Admin can refresh all permissions
  if (!currentStaffData || currentStaffData.role !== 'Super Admin') {
    return c.json({ error: 'Only Super Admin can refresh permissions' }, 403);
  }

  try {
    const staffList = (await kv.get('staff:list')) || [];
    let updatedCount = 0;

    for (const staffId of staffList) {
      const staffData = await kv.get(`staff:${staffId}`);
      if (staffData) {
        const updatedPermissions = getDefaultPermissions(staffData.role);
        staffData.permissions = updatedPermissions;
        await kv.set(`staff:${staffId}`, staffData);
        updatedCount++;
      }
    }

    // Log activity
    await addActivity(user.id, currentStaffData.name, 'edit_staff', `Refreshed permissions for all users`, `Updated ${updatedCount} users`, getClientIP(c.req));

    return c.json({ success: true, message: `Updated permissions for ${updatedCount} users` });
  } catch (error) {
    console.log(`Refresh permissions error: ${error}`);
    return c.json({ error: 'Failed to refresh permissions' }, 500);
  }
});

// ==================== BANKS API ====================

// Get all banks
app.get('/make-server-63060bc2/banks', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData || !staffData.permissions?.bankDeposits?.view) {
    return c.json({ error: 'No permission to view banks' }, 403);
  }

  try {
    const banks = (await kv.get('banks:list')) || [];
    return c.json({ success: true, banks });
  } catch (error) {
    console.log(`Get banks error: ${error}`);
    return c.json({ error: 'Failed to fetch banks' }, 500);
  }
});

// Add new bank
app.post('/make-server-63060bc2/banks', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  if (!staffData || !staffData.permissions?.bankDeposits?.add) {
    return c.json({ error: 'No permission to add banks' }, 403);
  }

  try {
    const { bankName } = await c.req.json();

    if (!bankName || !bankName.trim()) {
      return c.json({ error: 'Bank name is required' }, 400);
    }

    // Check if bank already exists
    const banksList = (await kv.get('banks:list')) || [];
    const existingBank = banksList.find((b: any) => b.name.toLowerCase() === bankName.trim().toLowerCase());
    
    if (existingBank) {
      return c.json({ error: 'Bank with this name already exists' }, 400);
    }

    const bankId = `${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newBank = {
      id: bankId,
      name: bankName.trim(),
      createdAt: new Date().toISOString(),
      createdBy: user.id,
      createdByName: staffData.name,
    };

    // Add bank to list
    banksList.push(newBank);
    await kv.set('banks:list', banksList);

    // Log activity
    await addActivity(user.id, staffData.name, 'add_bank', `Created new bank: ${bankName}`, '', getClientIP(c.req));

    return c.json({ success: true, bank: newBank });
  } catch (error) {
    console.log(`Add bank error: ${error}`);
    return c.json({ error: 'Failed to add bank' }, 500);
  }
});

// Update bank
app.put('/make-server-63060bc2/banks/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  // Only admins can edit banks
  const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
  
  if (!staffData || !staffData.permissions?.bankDeposits?.edit || !isAdmin) {
    return c.json({ error: 'No permission to edit banks' }, 403);
  }

  try {
    const bankId = c.req.param('id');
    const { bankName } = await c.req.json();

    if (!bankName || !bankName.trim()) {
      return c.json({ error: 'Bank name is required' }, 400);
    }

    const banksList = (await kv.get('banks:list')) || [];
    const bankIndex = banksList.findIndex((b: any) => b.id === bankId);
    
    if (bankIndex === -1) {
      return c.json({ error: 'Bank not found' }, 404);
    }

    // Check if new name conflicts with existing banks
    const existingBank = banksList.find((b: any) => 
      b.id !== bankId && b.name.toLowerCase() === bankName.trim().toLowerCase()
    );
    
    if (existingBank) {
      return c.json({ error: 'Bank with this name already exists' }, 400);
    }

    const oldName = banksList[bankIndex].name;

    // Update bank
    banksList[bankIndex] = {
      ...banksList[bankIndex],
      name: bankName.trim(),
      updatedAt: new Date().toISOString(),
      updatedBy: user.id,
      updatedByName: staffData.name,
    };

    await kv.set('banks:list', banksList);

    // Log activity
    await addActivity(user.id, staffData.name, 'edit_bank', `Updated bank: ${oldName} → ${bankName}`, '', getClientIP(c.req));

    return c.json({ success: true, bank: banksList[bankIndex] });
  } catch (error) {
    console.log(`Update bank error: ${error}`);
    return c.json({ error: 'Failed to update bank' }, 500);
  }
});

// Delete bank
app.delete('/make-server-63060bc2/banks/:id', async (c) => {
  const { user, error } = await verifyUser(c.req.header('Authorization'));
  
  if (error || !user) {
    return c.json({ error: error || 'Unauthorized' }, 401);
  }

  const staffData = await kv.get(`staff:${user.id}`);
  
  // Only admins can delete banks
  const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
  
  if (!staffData || !staffData.permissions?.bankDeposits?.delete || !isAdmin) {
    return c.json({ error: 'No permission to delete banks' }, 403);
  }

  try {
    const bankId = c.req.param('id');
    const banksList = (await kv.get('banks:list')) || [];
    
    const bankIndex = banksList.findIndex((b: any) => b.id === bankId);
    
    if (bankIndex === -1) {
      return c.json({ error: 'Bank not found' }, 404);
    }

    const bankName = banksList[bankIndex].name;

    // Check if any bank transactions are using this bank
    const bankDepositsList = (await kv.get('bankDeposits:list')) || [];
    let hasTransactions = false;
    
    for (const depositId of bankDepositsList) {
      const deposit = await kv.get(`bankDeposit:${depositId}`);
      if (deposit && deposit.bankId === bankId) {
        hasTransactions = true;
        break;
      }
    }

    if (hasTransactions) {
      return c.json({ error: 'Cannot delete bank that has transactions' }, 400);
    }

    // Remove bank from list
    banksList.splice(bankIndex, 1);
    await kv.set('banks:list', banksList);

    // Log activity
    await addActivity(user.id, staffData.name, 'delete_bank', `Deleted bank: ${bankName}`, '', getClientIP(c.req));

    return c.json({ success: true });
  } catch (error) {
    console.log(`Delete bank error: ${error}`);
    return c.json({ error: 'Failed to delete bank' }, 500);
  }
});

// ==================== HELPER FUNCTIONS ====================

function getClientIP(req: any): string {
  // Try to get IP from various headers
  const forwardedFor = req.header('x-forwarded-for');
  if (forwardedFor) {
    return forwardedFor.split(',')[0].trim();
  }
  
  const realIP = req.header('x-real-ip');
  if (realIP) {
    return realIP;
  }
  
  const cfConnectingIP = req.header('cf-connecting-ip');
  if (cfConnectingIP) {
    return cfConnectingIP;
  }
  
  return 'Unknown';
}

// Full permissions - given to first user automatically
function getFullPermissions() {
  return {
    dashboard: { view: true, add: true, edit: true, delete: true, activity: true },
    deposits: { view: true, add: true, edit: true, delete: true, activity: true },
    bankDeposits: { view: true, add: true, edit: true, delete: true, activity: true },
    staffManagement: { view: true, add: true, edit: true, delete: true, activity: true },
  };
}

// Empty permissions - all other users must be manually assigned permissions
function getEmptyPermissions() {
  return {
    dashboard: { view: false, add: false, edit: false, delete: false, activity: false },
    deposits: { view: false, add: false, edit: false, delete: false, activity: false },
    bankDeposits: { view: false, add: false, edit: false, delete: false, activity: false },
    staffManagement: { view: false, add: false, edit: false, delete: false, activity: false },
  };
}

// For backward compatibility (used in refresh permissions)
function getDefaultPermissions(role: string) {
  // All permissions must be manually assigned - no role-based defaults
  return getEmptyPermissions();
}

async function addActivity(userId: string, userName: string, action: string, description: string, details?: string, ipAddress?: string) {
  const activityId = `${Date.now()}_${userId}_${Math.random().toString(36).substr(2, 9)}`;
  
  const activity = {
    id: activityId,
    userId,
    userName,
    action,
    description,
    details: details || '',
    ipAddress: ipAddress || 'Unknown',
    timestamp: new Date().toISOString(),
  };

  await kv.set(`activity:${activityId}`, activity);
  
  // Add to activities list (keep last 1000)
  const activitiesList = (await kv.get('activities:list')) || [];
  activitiesList.unshift(activityId);
  if (activitiesList.length > 1000) {
    const removed = activitiesList.slice(1000);
    await kv.mdel(removed.map((id: string) => `activity:${id}`));
    activitiesList.splice(1000);
  }
  await kv.set('activities:list', activitiesList);
}

// ==================== UTILITY ROUTES (Admin/Debug) ====================

// Fix first user permissions (if they got created without proper permissions)
app.post('/make-server-63060bc2/fix-admin-permissions', async (c) => {
  try {
    const { user, error: authError } = await verifyUser(c.req.header('Authorization'));
    
    if (authError || !user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    // Get current staff data
    const currentStaffData = await kv.get(`staff:${user.id}`);
    
    if (!currentStaffData) {
      return c.json({ error: 'Staff data not found' }, 404);
    }

    // Check if user is the first user
    const staffList = (await kv.get('staff:list')) || [];
    const isFirstUser = staffList.length === 1 && staffList[0] === user.id;

    if (!isFirstUser) {
      return c.json({ error: 'Only the first user can use this endpoint' }, 403);
    }

    // Update with full permissions
    const updatedStaffData = {
      ...currentStaffData,
      permissions: getFullPermissions(),
    };

    await kv.set(`staff:${user.id}`, updatedStaffData);

    console.log(`Fixed permissions for first user: ${currentStaffData.email}`);

    return c.json({ 
      success: true, 
      message: 'Permissions updated successfully',
      user: updatedStaffData 
    });
  } catch (error: any) {
    console.error('Fix permissions error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// Get current user's full data (for debugging)
app.get('/make-server-63060bc2/debug/me', async (c) => {
  try {
    const { user, error: authError } = await verifyUser(c.req.header('Authorization'));
    
    if (authError || !user) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    const staffData = await kv.get(`staff:${user.id}`);
    const staffList = await kv.get('staff:list');

    return c.json({ 
      user,
      staffData,
      staffList,
      isFirstUser: staffList && staffList.length === 1 && staffList[0] === user.id
    });
  } catch (error: any) {
    console.error('Debug me error:', error);
    return c.json({ error: error.message }, 500);
  }
});

// ==================== DASHBOARD ROUTES ====================

// Get dashboard metrics with date filtering (optimized for performance)
app.get('/make-server-63060bc2/dashboard/metrics', async (c) => {
  try {
    const { user, error } = await verifyUser(c.req.header('Authorization'));
    
    if (error || !user) {
      return c.json({ error: error || 'Unauthorized' }, 401);
    }

    let staffData = await kv.get(`staff:${user.id}`);
    
    if (!staffData) {
      return c.json({ error: 'Staff not found' }, 404);
    }

    // AUTO-FIX: Ensure permissions exist
    if (!staffData.permissions || Object.keys(staffData.permissions).length === 0) {
      console.log(`Auto-fixing missing permissions for user in dashboard endpoint: ${staffData.email}`);
      
      const staffList = (await kv.get('staff:list')) || [];
      const isFirstUser = staffList.length === 1 && staffList[0] === user.id;
      
      if (isFirstUser || staffData.role === 'Super Admin' || staffData.role === 'Admin') {
        staffData.permissions = getFullPermissions();
      } else {
        staffData.permissions = {
          dashboard: { view: true, viewAll: false },
          deposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
          bankDeposits: { view: true, add: true, edit: true, delete: false, viewAll: false },
          staffManagement: { view: false, add: false, edit: false, delete: false, archive: false, restore: false, viewAll: false },
          activityLogs: { view: true, viewAll: false },
          settings: { view: true, edit: false }
        };
      }
      await kv.set(`staff:${user.id}`, staffData);
    }

    if (!staffData.permissions?.dashboard?.view) {
      return c.json({ error: 'No permission to view dashboard' }, 403);
    }

    // Get date filter parameters
    const dateFilter = c.req.query('dateFilter') || 'all'; // 'all', 'today', 'week', 'month'
    const dateFrom = c.req.query('dateFrom') || '';
    const dateTo = c.req.query('dateTo') || '';

    // Helper function to check if date is in range
    const isDateInRange = (dateStr: string): boolean => {
      const date = new Date(dateStr);
      const now = new Date();

      // Custom date range
      if (dateFrom || dateTo) {
        const from = dateFrom ? new Date(dateFrom) : null;
        const to = dateTo ? new Date(dateTo) : null;
        
        if (from && to) {
          return date >= from && date <= to;
        } else if (from) {
          return date >= from;
        } else if (to) {
          return date <= to;
        }
      }

      // Predefined filters
      switch (dateFilter) {
        case 'today':
          return date.toDateString() === now.toDateString();
        case 'week':
          const weekAgo = new Date(now);
          weekAgo.setDate(now.getDate() - 7);
          return date >= weekAgo && date <= now;
        case 'month':
          const monthAgo = new Date(now);
          monthAgo.setMonth(now.getMonth() - 1);
          return date >= monthAgo && date <= now;
        case 'all':
        default:
          return true;
      }
    };

    // Fetch all deposits
    const depositsList = (await kv.get('deposits:list')) || [];
    let deposits = await kv.mget(depositsList.map((id: string) => `deposit:${id}`));
    deposits = deposits.filter((d: any) => d !== null);

    // Fetch all withdrawals (bank deposits)
    const withdrawalsList = (await kv.get('bankDeposits:list')) || [];
    let withdrawals = await kv.mget(withdrawalsList.map((id: string) => `bankDeposit:${id}`));
    withdrawals = withdrawals.filter((w: any) => w !== null);

    // Role-based filtering (Admin sees all, Staff sees only their own)
    const isAdmin = staffData.role === 'Admin' || staffData.role === 'Super Admin';
    if (!isAdmin) {
      deposits = deposits.filter((d: any) => d.submittedBy === user.id);
      withdrawals = withdrawals.filter((w: any) => w.submittedBy === user.id);
    }

    // Apply date filters
    deposits = deposits.filter((d: any) => isDateInRange(d.date));
    withdrawals = withdrawals.filter((w: any) => isDateInRange(w.date));

    // Calculate metrics (ON BACKEND for performance!)
    const totalDeposits = deposits.reduce((sum: number, deposit: any) => 
      sum + (deposit.localDeposit || 0) + (deposit.usdtDeposit || 0) + (deposit.cashDeposit || 0), 0
    );

    const totalWithdrawals = withdrawals.reduce((sum: number, withdrawal: any) => 
      sum + (withdrawal.amount || 0), 0
    );

    const totalBalance = totalDeposits - totalWithdrawals;

    const totalCompanyExpenses = deposits.reduce((sum: number, deposit: any) => {
      const expenses = deposit.expenses || [];
      return sum + expenses.reduce((expSum: number, expense: any) => expSum + (expense.amount || 0), 0);
    }, 0);

    const balanceExcludingExpenses = totalBalance - totalCompanyExpenses;

    const totalClientIncentives = deposits.reduce((sum: number, deposit: any) => {
      const incentives = deposit.clientIncentives || [];
      return sum + incentives.reduce((incSum: number, incentive: any) => incSum + (incentive.amount || 0), 0);
    }, 0);

    const netProfit = balanceExcludingExpenses - totalClientIncentives;

    // Return only summary metrics (not full data for performance!)
    return c.json({
      success: true,
      metrics: {
        totalDeposits,
        totalWithdrawals,
        totalBalance,
        totalCompanyExpenses,
        balanceExcludingExpenses,
        totalClientIncentives,
        netProfit,
      },
      counts: {
        depositsCount: deposits.length,
        withdrawalsCount: withdrawals.length,
      },
      dateRange: {
        dateFilter,
        dateFrom,
        dateTo,
      }
    });

  } catch (error: any) {
    console.error('Error fetching dashboard metrics:', error);
    return c.json({ error: 'Failed to fetch dashboard metrics', details: error.message }, 500);
  }
});

// ==================== START SERVER ====================

Deno.serve(app.fetch);
