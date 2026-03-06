/**
 * Login Modal Component
 * Full-screen modal for user authentication
 * Must login to use the application
 */
import { useState } from 'react';
import { Loader2, Eye, EyeOff, AlertCircle, LogIn } from 'lucide-react';
import { motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useAuthStore } from '@/stores/auth';
import { useTranslation } from 'react-i18next';
import LogoSvg from '@/assets/svg/logo.svg';

export function LoginModal() {
  const { t } = useTranslation('auth');
  const { login, loading, error } = useAuthStore();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLocalError(null);

    if (!username.trim()) {
      setLocalError(t('error.usernameRequired'));
      return;
    }

    if (!password.trim()) {
      setLocalError(t('error.passwordRequired'));
      return;
    }

    const success = await login(username.trim(), password);
    if (!success) {
      // Error is handled by the store
    }
  };

  const displayError = localError || error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.2 }}
      >
        <Card className="w-[400px] shadow-2xl">
          <CardHeader className="text-center pb-2">
            <div className="flex justify-center mb-4">
              <img src={LogoSvg} className="w-16 h-16 text-primary" />
            </div>
            <CardTitle className="text-2xl">{t('title')}</CardTitle>
            <CardDescription>{t('description')}</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Error message */}
              {displayError && (
                <motion.div
                  initial={{ opacity: 0, y: -10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex items-center gap-2 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm"
                >
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  <span>{displayError}</span>
                </motion.div>
              )}

              {/* Username */}
              <div className="space-y-2">
                <Label htmlFor="username">{t('username')}</Label>
                <Input
                  id="username"
                  type="text"
                  placeholder={t('usernamePlaceholder')}
                  value={username}
                  onChange={(e) => {
                    setUsername(e.target.value);
                    setLocalError(null);
                  }}
                  disabled={loading}
                  autoComplete="username"
                  autoFocus
                />
              </div>

              {/* Password */}
              <div className="space-y-2">
                <Label htmlFor="password">{t('password')}</Label>
                <div className="relative">
                  <Input
                    id="password"
                    type={showPassword ? 'text' : 'password'}
                    placeholder={t('passwordPlaceholder')}
                    value={password}
                    onChange={(e) => {
                      setPassword(e.target.value);
                      setLocalError(null);
                    }}
                    disabled={loading}
                    autoComplete="current-password"
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    tabIndex={-1}
                  >
                    {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    {t('loggingIn')}
                  </>
                ) : (
                  <>
                    <LogIn className="h-4 w-4 mr-2" />
                    {t('login')}
                  </>
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}
