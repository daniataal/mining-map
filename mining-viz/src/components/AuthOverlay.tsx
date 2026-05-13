import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Card, CardHeader, CardTitle, CardContent, CardFooter } from './ui/card';
import { LucideLock, LucideUser, LucideShieldAlert } from 'lucide-react';
import { motion } from 'framer-motion';

interface AuthOverlayProps {
  onLogin: (user: string, pass: string) => void;
  error: string | null;
}

export default function AuthOverlay({ onLogin, error }: AuthOverlayProps) {
    const { t } = useI18n();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onLogin(username, password);
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
                        <div className="w-12 h-12 bg-amber-500/10 rounded-2xl flex items-center justify-center mx-auto mb-4 border border-amber-500/20">
                            <LucideLock className="w-6 h-6 text-amber-500" />
                        </div>
                        <CardTitle className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">
                            {t("גישה למערכת", "MadSan Global Intelligence")}
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
                                        required
                                    />
                                </div>
                            </div>
                            <div className="space-y-2">
                                <div className="relative">
                                    <LucideLock className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
                                    <Input 
                                        type="password" 
                                        placeholder={t("סיסמה", "Password")}
                                        className="pl-10 bg-slate-50 dark:bg-slate-950 border-slate-200 dark:border-slate-800 focus:ring-amber-500 text-slate-900 dark:text-white"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        required
                                    />
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
                                className="w-full bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold h-11 text-base mt-2 transition-all active:scale-[0.98]"
                            >
                                {t("התחבר", "Sign In")}
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
                            {t("צוות מורשה בלבד • 2026 MadSan Global Intelligence", "Authorized Personnel Only • 2026 MadSan Global Intelligence")}
                        </p>
                    </CardFooter>
                </Card>
            </motion.div>
        </div>
    );
}
