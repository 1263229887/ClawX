/**
 * Auth State Store
 * Manages user authentication state with persistent login
 */
import { create } from 'zustand';
import axios from 'axios';
import { toast } from 'sonner';

interface User {
  username: string;
  realname?: string;
}

interface AuthState {
  isLoggedIn: boolean;
  user: User | null;
  loading: boolean;
  error: string | null;

  // Actions
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
}

// API base URL
const getApiBaseUrl = () => {
  // 开发环境使用 Vite 代理，生产环境使用真实地址
  const isDev = window.electron?.isDev;
  if (isDev) {
    // 开发环境通过 Vite proxy 代理到 http://192.168.80.8
    return '/api/dana';
  }
  // 生产环境使用 https://mail.danaai.net
  return 'https://mail.danaai.net';
};

export const useAuthStore = create<AuthState>((set) => ({
  isLoggedIn: false,
  user: null,
  loading: true, // Start with loading to check auth on mount
  error: null,

  login: async (username: string, password: string) => {
    set({ loading: true, error: null });

    try {
      const baseUrl = getApiBaseUrl();
      const loginUrl = `${baseUrl}/auth/login/form`;
      
      // 使用 FormData (multipart/form-data) 格式
      const formData = new FormData();
      formData.append('name', username);
      formData.append('pwd', password);
      formData.append('source', 'pc');

      console.log('[AuthStore] Calling login API:', loginUrl);
      
      const response = await axios.post(loginUrl, formData);

      console.log('[AuthStore] API response:', response.data);

      const result = response.data;
      
      // 根据 code 字段判断：code=200 为成功
      if (result.code === 200 && result.data) {
        const { token, userInfo, refreshToken, expiresAt } = result.data;
        
        // 通过 IPC 保存完整的认证数据到主进程持久化存储
        await window.electron.ipcRenderer.invoke('auth:saveToken', {
          token,
          userInfo,
          refreshToken,
          expiresAt,
        });

        set({
          isLoggedIn: true,
          user: { 
            username: userInfo.userName,
            realname: userInfo.realname,
          },
          loading: false,
          error: null,
        });
        
        // 稍微延迟显示，确保 UI 更新完成后 toast 可见
        setTimeout(() => {
          toast.success(`欢迎回来，${userInfo.realname || userInfo.userName}！`);
        }, 100);
        
        return true;
      } else {
        const errorMsg = result.message || result.msg || 'Login failed';
        set({
          isLoggedIn: false,
          user: null,
          loading: false,
          error: errorMsg,
        });
        return false;
      }
    } catch (error) {
      console.error('[AuthStore] Login error:', error);
      const errorMsg = axios.isAxiosError(error) 
        ? (error.response?.data?.message || error.message)
        : String(error);
      set({
        isLoggedIn: false,
        user: null,
        loading: false,
        error: errorMsg,
      });
      return false;
    }
  },

  logout: async () => {
    set({ loading: true });

    try {
      await window.electron.ipcRenderer.invoke('auth:logout');
      set({
        isLoggedIn: false,
        user: null,
        loading: false,
        error: null,
      });
    } catch (error) {
      console.error('Logout error:', error);
      set({
        isLoggedIn: false,
        user: null,
        loading: false,
        error: null,
      });
    }
  },

  checkAuth: async () => {
    set({ loading: true });

    try {
      const result = (await window.electron.ipcRenderer.invoke('auth:check')) as {
        isLoggedIn: boolean;
        user?: User;
      };

      console.log('[AuthStore] checkAuth result:', result);

      set({
        isLoggedIn: result.isLoggedIn,
        user: result.user || null,
        loading: false,
      });
    } catch (error) {
      console.error('Auth check error:', error);
      set({
        isLoggedIn: false,
        user: null,
        loading: false,
      });
    }
  },
}));
