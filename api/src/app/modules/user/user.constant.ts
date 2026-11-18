//'admin' | 'user' | 'faculty'
export const USER_ROLE = {
    host: 'host',
    thrillseekers:"thrillseekers", 
    admin: 'admin',
    superAdmin:'superAdmin'
  } as const;
  
  export const USER_ACCESSIBILITY={
    isProgress:'isProgress',
    blocked:'blocked'
  }  as const;

export const socialAuth={
  googleAuth:"googleAuth"
} as const;

// Super admin login comes from the environment (never commit credentials).
// If SUPER_ADMIN_EMAIL / SUPER_ADMIN_PASSWORD are not set, the account is left untouched.
export const superAdminCredentials = {
  fastname: "Super",
  lastname: "Admin",
  email: process.env.SUPER_ADMIN_EMAIL || "",
  password: process.env.SUPER_ADMIN_PASSWORD || "",
  phoneNumber: process.env.SUPER_ADMIN_PHONE || "",
  dateOfBirth: "2000-09-20",
  isVerify: true,
};

export const randomGroupChatId={
  receiverId:"69026f71d34a63278bb65f60"
} as const;
