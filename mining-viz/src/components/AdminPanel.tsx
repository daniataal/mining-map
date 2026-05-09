import { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { User, ActivityLog, MeetingPoint, MinerListing } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { LucideUsers, LucideHistory, LucideMapPin, LucidePickaxe, LucidePlus, LucideEdit, LucideChartBar } from 'lucide-react';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  token?: string;
  isFullPage?: boolean;
}

export default function AdminPanel({ isOpen, onClose, token, isFullPage }: AdminPanelProps) {
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState<User[]>([]);
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [meetingPoints, setMeetingPoints] = useState<MeetingPoint[]>([]);
    const [minerListings, setMinerListings] = useState<MinerListing[]>([]);
    
    // Activity Log per user
    const [selectedUserForLogs, setSelectedUserForLogs] = useState<User | null>(null);
    const [userLogs, setUserLogs] = useState<ActivityLog[]>([]);
    const [loadingUserLogs, setLoadingUserLogs] = useState(false);

    const [userEditorOpen, setUserEditorOpen] = useState(false);
    const [userBeingEdited, setUserBeingEdited] = useState<User | null>(null);
    const [formUsername, setFormUsername] = useState('');
    const [formPassword, setFormPassword] = useState('');
    const [formRole, setFormRole] = useState<'admin' | 'user'>('user');
    const [userFormError, setUserFormError] = useState<string | null>(null);
    const [userFormSubmitting, setUserFormSubmitting] = useState(false);

    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

    const authHeaders = (): HeadersInit => {
        const h: Record<string, string> = {};
        if (token) h.Authorization = `Bearer ${token}`;
        return h;
    };

    const fetchData = async (endpoint: string, setter: (val: any) => void) => {
        try {
            const res = await fetch(`${API_BASE}${endpoint}`, { headers: authHeaders() });
            const data = await res.json();
            setter(data);
        } catch (err) {
            console.error(`Failed to fetch ${endpoint}`, err);
        }
    };

    const openCreateUser = () => {
        setUserBeingEdited(null);
        setFormUsername('');
        setFormPassword('');
        setFormRole('user');
        setUserFormError(null);
        setUserEditorOpen(true);
    };

    const openEditUser = (u: User) => {
        setUserBeingEdited(u);
        setFormUsername(u.username);
        setFormPassword('');
        setFormRole(u.role);
        setUserFormError(null);
        setUserEditorOpen(true);
    };

    const handleUserFormSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const username = formUsername.trim();
        if (!username) {
            setUserFormError(t('נדרש שם משתמש', 'Username is required'));
            return;
        }
        if (!userBeingEdited && !formPassword) {
            setUserFormError(t('נדרשת סיסמה', 'Password is required'));
            return;
        }

        setUserFormSubmitting(true);
        setUserFormError(null);
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            ...authHeaders() as Record<string, string>,
        };

        try {
            if (!userBeingEdited) {
                const res = await fetch(`${API_BASE}/auth/register`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify({ username, password: formPassword, role: formRole }),
                });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(text || res.statusText);
                }
            } else {
                const body: { username?: string; password?: string; role?: string } = {};
                if (username !== userBeingEdited.username) body.username = username;
                if (formPassword) body.password = formPassword;
                if (formRole !== userBeingEdited.role) body.role = formRole;
                if (Object.keys(body).length === 0) {
                    setUserEditorOpen(false);
                    return;
                }
                const res = await fetch(`${API_BASE}/auth/users/${userBeingEdited.id}`, {
                    method: 'PUT',
                    headers,
                    body: JSON.stringify(body),
                });
                if (!res.ok) {
                    const text = await res.text();
                    throw new Error(text || res.statusText);
                }
            }
            await fetchData('/auth/users', setUsers);
            setUserEditorOpen(false);
        } catch (err) {
            setUserFormError(err instanceof Error ? err.message : String(err));
        } finally {
            setUserFormSubmitting(false);
        }
    };

    useEffect(() => {
        if (isOpen || isFullPage) {
            fetchData('/auth/users', setUsers);
            fetchData('/activity/logs?limit=100', setLogs);
            fetchData('/meeting-points', setMeetingPoints);
            fetchData('/miner-listings', setMinerListings);
        }
    }, [isOpen, isFullPage]);

    const fetchUserLogs = async (user: User) => {
        setSelectedUserForLogs(user);
        setLoadingUserLogs(true);
        try {
            const res = await fetch(`${API_BASE}/activity/logs/user/${user.id}?limit=200`, {
                headers: authHeaders(),
            });
            const data = await res.json();
            setUserLogs(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Failed to fetch user logs", err);
            setUserLogs([]);
        } finally {
            setLoadingUserLogs(false);
        }
    };

    const AdminContent = (
        <div className={`flex flex-col bg-white dark:bg-slate-950 text-slate-800 dark:text-slate-100 ${isFullPage ? 'h-full w-full' : ''}`}>
            <header className="p-6 border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-slate-900/20">
                <h1 className="text-xl font-black tracking-widest flex items-center gap-3 uppercase text-slate-900 dark:text-white">
                    <span className="text-amber-500 text-2xl">🛡️</span>
                    {t("לוח בקרה למנהלים", "Admin Control Panel")}
                </h1>
            </header>

            <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                <div className="px-2 sm:px-6 border-b border-black/5 dark:border-white/5 bg-black/[0.02] dark:bg-white/[0.02] overflow-x-auto">
                    <TabsList className="bg-transparent h-14 w-max min-w-full justify-start gap-2 sm:gap-4 p-0">
                        <TabsTrigger value="users" className="text-slate-500 dark:text-slate-400 data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-3 sm:px-4 gap-1.5 sm:gap-2 font-black uppercase text-[10px] tracking-widest hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap">
                            <LucideUsers className="w-4 h-4" /> {t("משתמשים", "Users")}
                        </TabsTrigger>
                        <TabsTrigger value="logs" className="text-slate-500 dark:text-slate-400 data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-3 sm:px-4 gap-1.5 sm:gap-2 font-black uppercase text-[10px] tracking-widest hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap">
                            <LucideHistory className="w-4 h-4" /> {t("יומנים", "Logs")}
                        </TabsTrigger>
                        <TabsTrigger value="meeting-points" className="text-slate-500 dark:text-slate-400 data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-3 sm:px-4 gap-1.5 sm:gap-2 font-black uppercase text-[10px] tracking-widest hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap">
                            <LucideMapPin className="w-4 h-4" /> {t("נקודות מפגש", "Meeting Points")}
                        </TabsTrigger>
                        <TabsTrigger value="miner-listings" className="text-slate-500 dark:text-slate-400 data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-3 sm:px-4 gap-1.5 sm:gap-2 font-black uppercase text-[10px] tracking-widest hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap">
                            <LucidePickaxe className="w-4 h-4" /> {t("מודעות כורים", "Miner Listings")}
                        </TabsTrigger>
                    </TabsList>
                </div>

                <div className="flex-1 overflow-hidden">
                    <TabsContent value="users" className="h-full m-0 p-6 overflow-y-auto space-y-8">
                        <Card className="bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 shadow-2xl">
                            <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 dark:border-white/5 pb-6">
                                <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">{t("ניהול משתמשים", "User Management")}</CardTitle>
                                <Button type="button" size="sm" onClick={openCreateUser} className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black uppercase text-[10px] tracking-widest px-6 h-9 rounded-xl shadow-[0_0_20px_rgba(245,158,11,0.2)]">
                                    <LucidePlus className="w-4 h-4 mr-2 stroke-[3]" /> {t("משתמש חדש", "New User")}
                                </Button>
                            </CardHeader>
                            <CardContent className="pt-6 overflow-x-auto">
                                <Table className="min-w-[500px]">
                                    <TableHeader>
                                        <TableRow className="border-black/5 dark:border-white/5 hover:bg-transparent">
                                            <TableHead className="text-slate-500 dark:text-slate-400 font-black uppercase text-[9px] tracking-widest">{t("משתמש", "Username")}</TableHead>
                                            <TableHead className="text-slate-500 dark:text-slate-400 font-black uppercase text-[9px] tracking-widest">{t("תפקיד", "Role")}</TableHead>
                                            <TableHead className="text-slate-500 dark:text-slate-400 font-black uppercase text-[9px] tracking-widest">{t("נוצר בתאריך", "Created")}</TableHead>
                                            <TableHead className="text-right text-slate-500 dark:text-slate-400 font-black uppercase text-[9px] tracking-widest">{t("פעולות", "Actions")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {users.map(u => (
                                            <TableRow key={u.id} className="border-black/5 dark:border-white/5 hover:bg-black/[0.02] dark:hover:bg-white/[0.02] transition-colors">
                                                <TableCell className="font-bold text-slate-700 dark:text-slate-100">{u.username}</TableCell>
                                                <TableCell>
                                                    <Badge variant={u.role === 'admin' ? 'default' : 'secondary'} className={u.role === 'admin' ? 'bg-amber-500/10 text-amber-500 border-amber-500/20 px-2 font-bold uppercase text-[9px]' : 'bg-slate-200 dark:bg-slate-800 text-slate-500 dark:text-slate-400 border-transparent px-2 font-bold uppercase text-[9px]'}>
                                                        {u.role}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-slate-600 dark:text-slate-300 text-[10px] font-bold">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                                                <TableCell className="text-right space-x-2">
                                                    <Button type="button" variant="outline" size="sm" onClick={() => openEditUser(u)} className="h-9 min-w-[44px] border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-slate-700 dark:text-white text-[9px] font-black uppercase tracking-widest">
                                                        <LucideEdit className="w-3 h-3 mr-1 text-amber-500" /> {t("עריכה", "Edit")}
                                                    </Button>
                                                    <Button type="button" variant="outline" size="sm" onClick={() => fetchUserLogs(u)} className="h-9 min-w-[44px] border-black/10 dark:border-white/10 bg-black/5 dark:bg-white/5 hover:bg-black/10 dark:hover:bg-white/10 text-slate-700 dark:text-white text-[9px] font-black uppercase tracking-widest">
                                                        <LucideChartBar className="w-3 h-3 mr-1 text-amber-500" /> {t("פעילות", "Activity")}
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="logs" className="h-full m-0 p-6 overflow-y-auto">
                        <Card className="bg-white/[0.02] border-white/5">
                            <CardHeader className="border-b border-white/5 pb-6">
                                <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-200">{t("פעילות מערכת אחרונה", "Recent System Activity")}</CardTitle>
                            </CardHeader>
                            <CardContent className="pt-6 overflow-x-auto">
                                <Table className="min-w-[540px]">
                                    <TableHeader>
                                        <TableRow className="border-white/5 hover:bg-transparent">
                                            <TableHead className="text-slate-400 font-black uppercase text-[9px] tracking-widest">{t("זמן", "Time")}</TableHead>
                                            <TableHead className="text-slate-400 font-black uppercase text-[9px] tracking-widest">{t("משתמש", "User")}</TableHead>
                                            <TableHead className="text-slate-400 font-black uppercase text-[9px] tracking-widest">{t("פעולה", "Action")}</TableHead>
                                            <TableHead className="text-slate-400 font-black uppercase text-[9px] tracking-widest">{t("פרטים", "Details")}</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {logs.map(log => (
                                            <TableRow key={log.id} className="border-white/5 hover:bg-white/[0.02]">
                                                <TableCell className="text-[10px] font-bold text-slate-300">{new Date(log.timestamp).toLocaleString()}</TableCell>
                                                <TableCell className="font-bold text-slate-100">{log.username}</TableCell>
                                                <TableCell>
                                                    <Badge className="bg-blue-500/10 text-blue-400 border-blue-500/20 text-[9px] font-black uppercase">
                                                        {log.action}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-slate-100 text-[10px] font-medium opacity-80">{log.details}</TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>
                </div>
            </Tabs>
        </div>
    );

    const SecondaryDialogs = (
        <Dialog open={!!selectedUserForLogs} onOpenChange={() => setSelectedUserForLogs(null)}>
            <DialogContent className="w-[95vw] max-w-3xl h-[85vh] flex flex-col bg-slate-900 border-white/10 shadow-2xl">
                <DialogHeader className="border-b border-white/5 pb-4">
                    <DialogTitle className="text-sm font-black uppercase tracking-widest text-amber-500">
                        {t("יומן פעילות:", "Activity Log:")} {selectedUserForLogs?.username}
                    </DialogTitle>
                </DialogHeader>
                <div className="flex-1 overflow-y-auto py-4">
                    {loadingUserLogs ? (
                        <div className="h-full flex items-center justify-center text-slate-500 font-black uppercase text-[10px] tracking-widest">{t("טוען...", "Loading Intelligence...")}</div>
                    ) : (
                        <Table>
                            <TableHeader>
                                <TableRow className="border-white/5">
                                    <TableHead className="text-[9px] font-black uppercase tracking-widest text-slate-500">{t("זמן", "Time")}</TableHead>
                                    <TableHead className="text-[9px] font-black uppercase tracking-widest text-slate-500">{t("פעולה", "Action")}</TableHead>
                                    <TableHead className="text-[9px] font-black uppercase tracking-widest text-slate-500">{t("פרטים", "Details")}</TableHead>
                                </TableRow>
                            </TableHeader>
                            <TableBody>
                                {userLogs.map((log, idx) => (
                                    <TableRow key={idx} className="border-white/5">
                                        <TableCell className="text-[10px] font-bold text-slate-500">{new Date(log.timestamp).toLocaleString()}</TableCell>
                                        <TableCell>
                                            <Badge className="text-[9px] font-black uppercase bg-slate-800 text-slate-400 border-transparent">{log.action}</Badge>
                                        </TableCell>
                                        <TableCell className="text-[10px] font-medium text-slate-400">{log.details}</TableCell>
                                    </TableRow>
                                ))}
                            </TableBody>
                        </Table>
                    )}
                </div>
            </DialogContent>
        </Dialog>
    );

    const UserEditorDialog = (
        <Dialog
            open={userEditorOpen}
            onOpenChange={(open) => {
                if (!open) setUserEditorOpen(false);
            }}
        >
            <DialogContent className="max-w-md bg-slate-900 border-white/10 text-slate-100 shadow-2xl">
                <DialogHeader className="border-b border-white/5 pb-4">
                    <DialogTitle className="text-sm font-black uppercase tracking-widest text-amber-500">
                        {userBeingEdited ? t('עריכת משתמש', 'Edit User') : t('משתמש חדש', 'New User')}
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleUserFormSubmit} className="space-y-4 pt-2">
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('שם משתמש', 'Username')} *</label>
                        <Input
                            value={formUsername}
                            onChange={(e) => setFormUsername(e.target.value)}
                            className="bg-slate-950 border-white/10"
                            autoComplete="username"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">
                            {t('סיסמה', 'Password')}
                            {userBeingEdited ? ` (${t('השאר ריק ללא שינוי', 'leave blank to keep')})` : ' *'}
                        </label>
                        <Input
                            type="password"
                            value={formPassword}
                            onChange={(e) => setFormPassword(e.target.value)}
                            className="bg-slate-950 border-white/10"
                            autoComplete="new-password"
                        />
                    </div>
                    <div className="space-y-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">{t('תפקיד', 'Role')}</label>
                        <Select value={formRole} onValueChange={(v) => setFormRole(v as 'admin' | 'user')}>
                            <SelectTrigger className="bg-slate-950 border-white/10 w-full">
                                <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-slate-900 border-white/10">
                                <SelectItem value="user" className="text-slate-100 focus:bg-white/10">{t('משתמש', 'User')}</SelectItem>
                                <SelectItem value="admin" className="text-slate-100 focus:bg-white/10">{t('מנהל', 'Admin')}</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>
                    {userFormError && (
                        <p className="text-xs text-red-400 font-medium">{userFormError}</p>
                    )}
                    <DialogFooter className="gap-2 sm:gap-0 pt-2">
                        <Button
                            type="button"
                            variant="outline"
                            className="border-white/10"
                            onClick={() => setUserEditorOpen(false)}
                            disabled={userFormSubmitting}
                        >
                            {t('ביטול', 'Cancel')}
                        </Button>
                        <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black uppercase text-[10px]" disabled={userFormSubmitting}>
                            {userFormSubmitting ? t('שומר...', 'Saving...') : t('שמור', 'Save')}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );

    if (isFullPage) return (
        <>
            {AdminContent}
            {SecondaryDialogs}
            {UserEditorDialog}
        </>
    );

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 bg-slate-950 border-white/10 overflow-hidden shadow-2xl">
                {AdminContent}
            </DialogContent>
            {SecondaryDialogs}
            {UserEditorDialog}
        </Dialog>
    );
}
