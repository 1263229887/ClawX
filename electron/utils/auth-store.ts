/**
 * Auth Storage
 * Persistent storage for user authentication state
 */

// Lazy-load electron-store (ESM module)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let authStoreInstance: any = null;

export interface UserInfo {
  id: string;
  userName: string;
  realname: string;
  loginAccount: string;
  phone: string;
  email: string | null;
  avatar: string | null;
  tenantId: string;
  relTenantIds: string;
  [key: string]: unknown; // 其他字段
}

export interface RefreshToken {
  value: string;
  expiration: number;
}

export interface AuthData {
  token: string | null;
  refreshToken: RefreshToken | null;
  userInfo: UserInfo | null;
  expiresAt: number | null;
  loginTime: string | null;
}

const defaults: AuthData = {
  token: null,
  refreshToken: null,
  userInfo: null,
  expiresAt: null,
  loginTime: null,
};

/**
 * Get the auth store instance (lazy initialization)
 */
async function getAuthStore() {
  if (!authStoreInstance) {
    const Store = (await import('electron-store')).default;
    authStoreInstance = new Store<AuthData>({
      name: 'auth',
      defaults,
    });
  }
  return authStoreInstance;
}

/**
 * Save auth data after successful login
 */
export async function saveAuthData(
  token: string,
  userInfo: UserInfo,
  refreshToken?: RefreshToken,
  expiresAt?: number
): Promise<void> {
  const store = await getAuthStore();
  store.set('token', token);
  store.set('userInfo', userInfo);
  store.set('refreshToken', refreshToken);
  store.set('expiresAt', expiresAt);
  store.set('loginTime', new Date().toISOString());
}

/**
 * Get current auth data
 */
export async function getAuthData(): Promise<AuthData> {
  const store = await getAuthStore();
  return {
    token: store.get('token'),
    refreshToken: store.get('refreshToken'),
    userInfo: store.get('userInfo'),
    expiresAt: store.get('expiresAt'),
    loginTime: store.get('loginTime'),
  };
}

/**
 * Clear auth data on logout
 */
export async function clearAuthData(): Promise<void> {
  const store = await getAuthStore();
  store.clear();
}

/**
 * Check if user is logged in
 */
export async function isLoggedIn(): Promise<boolean> {
  const data = await getAuthData();
  // 有有效的 token 和 userInfo 才算登录
  return Boolean(data.token && data.userInfo);
}
