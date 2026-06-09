import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './ui/card';
import { Eye, EyeOff, Loader2, LucideLock, LucideUser, LucideShieldAlert } from 'lucide-react';
import { motion } from 'framer-motion';
import BrandMark from './BrandMark';
import { BRAND_COPYRIGHT, BRAND_NAME } from '../lib/brand';

interface AuthOverlayProps {
  onLogin: (user: string, pass: string) => void | Promise<void>;
  error: string | null;
}

export default function AuthOverlay({ onLogin, error }: AuthOverlayProps) {
    const { t } = useI18n();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [showPassword, setShowPassword] = useState(false);
    const [isSigningIn, setIsSigningIn] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (isSigningIn) return;
        setIsSigningIn(true);
        try {
            await onLogin(username.trim(), password);
        } catch {
            // Parent handleLogin surfaces authError; keep spinner recovery here.
        } finally {
            setIsSigningIn(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-slate-200/80 dark:bg-slate-950/80 backdrop-blur-md z-[9999] flex flex-col items-center justify-center p-4">
            <motion.div
                initial={{ opacity: 0, scale: 0.95, y: 20 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                transition={{ duration: 0.4, ease: "easeOut" }}
                className="w-full max-w-md"
            >
                <Card className="bg-white dark:bg-slate-900 border-slate-200 dark:border-slate-800 shadow-2xl ring-1 ring-slate-200 dark:ring-slate-800">
                    <CardHeader className="space-y-2 text-center pb-8">
                        <div className="mx-auto mb-4 flex items-center justify-center">
                            <BrandMark size="lg" />
                        </div>
                        <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                            {t("גישה למערכת", BRAND_NAME)}
                        </CardTitle>
                        <p className="text-sm text-slate-500 dark:text-slate-400">
                            {t("אנא התחבר כדי לצפות ולנהל נתוני רישיונות", "Please sign in to view and manage license data.")}
                        </p>
                    </CardHeader>
                    <CardContent>
                        <form onSubmit={handleSubmit} className="space-y-4">
                            <div className="space-y-2">
                                <div className="relative">
                                    <LucideUser className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <Input 
                                        type="text" 
                                        placeholder={t("שם משתמש", "Username")}
                                        className="pl-10 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-amber-500 text-slate-900 dark:text-white"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        disabled={isSigningIn}
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="relative">
                                    <LucideLock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <Input 
                                        type={showPassword ? 'text' : 'password'}
                                        placeholder={t("סיסמה", "Password")}
                                        className="pl-10 pr-10 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-amber-500 text-slate-900 dark:text-white"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        disabled={isSigningIn}
                                        required
                                    />
                                    <button
                                        type="button"
                                        tabIndex={-1}
                                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 transition-colors disabled:opacity-50"
                                        onClick={() => setShowPassword((prev) => !prev)}
                                        disabled={isSigningIn}
                                        aria-label={showPassword ? t("הסתר סיסמה", "Hide password") : t("הצג סיסמה", "Show password")}
                                    >
                                        {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>

                            {error && (
                                <motion.div 
                                    initial={{ opacity: 0, height: 0 }}
                                    animate={{ opacity: 1, height: 'auto' }}
                                    className="flex items-center gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-500 text-xs font-medium"
                                >
                                    <LucideShieldAlert className="w-4 h-4" />
                                    {error}
                                </motion.div>
                            )}

                            <Button 
                                type="submit"
                                disabled={isSigningIn}
                                className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold h-11 text-base mt-2 transition-all active:scale-[0.98] disabled:opacity-80"
                            >
                                {isSigningIn ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        {t("מתחבר...", "Signing in...")}
                                    </>
                                ) : (
                                    t("התחבר", "Sign In")
                                )}
                            </Button>
                        </form>
                    </CardContent>
                    <CardFooter className="flex flex-col gap-4 text-center pb-8">
                        <div className="flex items-center gap-2 w-full">
                            <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1" />
                            <span className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-600 tracking-widest">{t("מערכת מאובטחת", "Secure System")}</span>
                            <div className="h-px bg-slate-200 dark:bg-slate-800 flex-1" />
                        </div>
                        <p className="text-[10px] text-slate-500 font-medium uppercase tracking-tight">
                            {t(`צוות מורשה בלבד • ${BRAND_COPYRIGHT}`, `Authorized Personnel Only • ${BRAND_COPYRIGHT}`)}
                        </p>
                    </CardFooter>
                </Card>
            </motion.div>
        </div>
    );
}
