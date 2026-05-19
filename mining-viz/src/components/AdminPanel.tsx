import { useState, useEffect } from 'react';
import { motion } from 'framer-motion';
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
import { LucideUsers, LucideHistory, LucideMapPin, LucidePickaxe, LucidePlus, LucideEdit, LucideChartBar, LucideTrash2, LucideDatabase, LucideActivity, LucideShip } from 'lucide-react';
import { toast } from 'sonner';
import { API_BASE, deleteAuthUser } from '../lib/api';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  token?: string;
  adminApiToken?: string;
  isFullPage?: boolean;
  currentUserId?: string | null;
}

type ComtradeSyncRun = {
  id: number;
  status: string;
  year?: number;
  requests_made?: number;
  rows_upserted?: number;
  started_at?: string;
  finished_at?: string | null;
  errors?: unknown[];
  note?: string | null;
};

type LicenseSyncRun = {
  id: number;
  source_id?: string | null;
  status: string;
  records_written?: number;
  records_fetched?: number;
  started_at?: string;
  finished_at?: string | null;
  drift_warning?: { drop_pct?: number; message?: string } | null;
};

type DataHealthPayload = {
  status?: string;
  license_sync_runs_latest?: LicenseSyncRun[];
  license_drift_alerts?: LicenseSyncRun[];
  comtrade_sync_runs?: ComtradeSyncRun[];
  license_counts_by_country?: Array<{ country: string; license_count: number }>;
  manually_edited_count?: number;
  petroleum_osm_layers?: Record<string, { feature_count?: number; last_fetched_at?: string }>;
};

const DEFAULT_ADMIN_API_TOKEN =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_ADMIN_API_TOKEN) || '';

export default function AdminPanel({
  isOpen,
  onClose,
  token,
  adminApiToken,
  isFullPage,
  currentUserId,
}: AdminPanelProps) {
    const { t } = useI18n();
    const [activeTab, setActiveTab] = useState('users');
    const [users, setUsers] = useState<User[]>([]);
    const [logs, setLogs] = useState<ActivityLog[]>([]);
    const [meetingPoints, setMeetingPoints] = useState<MeetingPoint[]>([]);
    const [minerListings, setMinerListings] = useState<MinerListing[]>([]);
    const [syncRuns, setSyncRuns] = useState<LicenseSyncRun[]>([]);
    const [syncAlerts, setSyncAlerts] = useState<LicenseSyncRun[]>([]);
    const [loadingSyncRuns, setLoadingSyncRuns] = useState(false);
    const [adminTokenInput, setAdminTokenInput] = useState(
      () => adminApiToken || DEFAULT_ADMIN_API_TOKEN || sessionStorage.getItem('meridian_admin_api_token') || ''
    );
    const [comtradeRuns, setComtradeRuns] = useState<ComtradeSyncRun[]>([]);
    const [loadingComtrade, setLoadingComtrade] = useState(false);
    const [comtradeSyncing, setComtradeSyncing] = useState(false);
    const [comtradeYear, setComtradeYear] = useState(String(new Date().getFullYear() - 2));
    const [dataHealth, setDataHealth] = useState<DataHealthPayload | null>(null);
    const [loadingDataHealth, setLoadingDataHealth] = useState(false);

    const resolvedAdminToken = (adminApiToken || adminTokenInput || '').trim();

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
    const [userPendingDelete, setUserPendingDelete] = useState<User | null>(null);
    const [deleteSubmitting, setDeleteSubmitting] = useState(false);

    const authHeaders = (): HeadersInit => {
        const h: Record<string, string> = {};
        if (token) h.Authorization = `Bearer ${token}`;
        return h;
    };

    const adminHeaders = (): HeadersInit => {
        const h: Record<string, string> = { ...authHeaders() as Record<string, string> };
        if (resolvedAdminToken) h['X-Admin-Token'] = resolvedAdminToken;
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

    const confirmDeleteUser = async () => {
        if (!userPendingDelete) return;
        if (!token?.trim()) {
            toast.error(t('נדרשת התחברות', 'You must be logged in to delete users.'));
            return;
        }
        setDeleteSubmitting(true);
        try {
            await deleteAuthUser(userPendingDelete.id, token);
            toast.success(t('המשתמש נמחק', 'User deleted'));
            setUserPendingDelete(null);
            await fetchData('/auth/users', setUsers);
        } catch (err: unknown) {
            const ax = err as { response?: { data?: unknown }; message?: string };
            const data = ax.response?.data;
            const msg =
                typeof data === 'string'
                    ? data
                    : data != null
                      ? JSON.stringify(data)
                      : ax.message;
            toast.error(msg || (err instanceof Error ? err.message : String(err)));
        } finally {
            setDeleteSubmitting(false);
        }
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

    const fetchComtradeRuns = async () => {
        if (!resolvedAdminToken) return;
        setLoadingComtrade(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/comtrade/sync-runs?limit=30`, {
                headers: adminHeaders(),
            });
            const data = await res.json();
            setComtradeRuns(Array.isArray(data?.runs) ? data.runs : []);
        } catch (err) {
            console.error('Failed to fetch Comtrade sync runs', err);
            setComtradeRuns([]);
        } finally {
            setLoadingComtrade(false);
        }
    };

    const triggerComtradeSync = async () => {
        if (!resolvedAdminToken) {
            toast.error(t('נדרש Admin API token', 'Admin API token required (X-Admin-Token)'));
            return;
        }
        setComtradeSyncing(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/comtrade/sync`, {
                method: 'POST',
                headers: { ...adminHeaders(), 'Content-Type': 'application/json' },
                body: JSON.stringify({ year: parseInt(comtradeYear, 10) || undefined }),
            });
            const data = await res.json();
            if (!res.ok || data.status === 'error') {
                throw new Error(data.message || data.reason || res.statusText);
            }
            toast.success(t('סנכרון Comtrade הושלם', 'Comtrade sync finished'));
            await fetchComtradeRuns();
        } catch (err) {
            toast.error(err instanceof Error ? err.message : String(err));
        } finally {
            setComtradeSyncing(false);
        }
    };

    const fetchDataHealth = async () => {
        if (!resolvedAdminToken) return;
        setLoadingDataHealth(true);
        try {
            const res = await fetch(`${API_BASE}/api/admin/data-health`, { headers: adminHeaders() });
            const data = await res.json();
            setDataHealth(data);
        } catch (err) {
            console.error('Failed to fetch data health', err);
            setDataHealth(null);
        } finally {
            setLoadingDataHealth(false);
        }
    };

    const fetchSyncRuns = async () => {
        if (!token?.trim()) return;
        setLoadingSyncRuns(true);
        try {
            const headers = authHeaders();
            const [runsRes, alertsRes] = await Promise.all([
                fetch(`${API_BASE}/api/open-data/sync-runs?per_source_latest=true&limit=100`, { headers }),
                fetch(`${API_BASE}/api/open-data/sync-alerts?limit=50`, { headers }),
            ]);
            const runsData = await runsRes.json();
            const alertsData = await alertsRes.json();
            setSyncRuns(Array.isArray(runsData?.runs) ? runsData.runs : []);
            setSyncAlerts(Array.isArray(alertsData?.alerts) ? alertsData.alerts : []);
        } catch (err) {
            console.error('Failed to fetch sync runs', err);
            setSyncRuns([]);
            setSyncAlerts([]);
        } finally {
            setLoadingSyncRuns(false);
        }
    };

    useEffect(() => {
        if (isOpen || isFullPage) {
            fetchData('/auth/users', setUsers);
            fetchData('/activity/logs?limit=100', setLogs);
            fetchData('/meeting-points', setMeetingPoints);
            fetchData('/miner-listings', setMinerListings);
            fetchSyncRuns();
            if (resolvedAdminToken) {
                fetchComtradeRuns();
                fetchDataHealth();
            }
        }
    }, [isOpen, isFullPage, token, resolvedAdminToken]);

    useEffect(() => {
        if (adminTokenInput.trim()) {
            sessionStorage.setItem('meridian_admin_api_token', adminTokenInput.trim());
        }
    }, [adminTokenInput]);

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
                        <TabsTrigger value="open-data" className="text-slate-500 dark:text-slate-400 data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-3 sm:px-4 gap-1.5 sm:gap-2 font-black uppercase text-[10px] tracking-widest hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap">
                            <LucideDatabase className="w-4 h-4" /> {t("נתונים פתוחים", "Open Data")}
                        </TabsTrigger>
                        <TabsTrigger value="comtrade" className="text-slate-500 dark:text-slate-400 data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-3 sm:px-4 gap-1.5 sm:gap-2 font-black uppercase text-[10px] tracking-widest hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap">
                            <LucideShip className="w-4 h-4" /> Comtrade
                        </TabsTrigger>
                        <TabsTrigger value="data-health" className="text-slate-500 dark:text-slate-400 data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-3 sm:px-4 gap-1.5 sm:gap-2 font-black uppercase text-[10px] tracking-widest hover:text-slate-900 dark:hover:text-white transition-colors whitespace-nowrap">
                            <LucideActivity className="w-4 h-4" /> {t('בריאות נתונים', 'Data health')}
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
                                                    <Button
                                                        type="button"
                                                        variant="destructive"
                                                        size="sm"
                                                        onClick={() => setUserPendingDelete(u)}
                                                        disabled={currentUserId != null && String(currentUserId) === String(u.id)}
                                                        title={
                                                            currentUserId != null && String(currentUserId) === String(u.id)
                                                                ? t('לא ניתן למחוק את המשתמש המחובר', 'Cannot delete the signed-in account')
                                                                : undefined
                                                        }
                                                        className="h-9 min-w-[44px] text-[9px] font-black uppercase tracking-widest"
                                                    >
                                                        <LucideTrash2 className="w-3 h-3 mr-1" /> {t('מחיקה', 'Delete')}
                                                    </Button>
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="open-data" className="h-full m-0 p-6 overflow-y-auto space-y-6">
                        <Card className="bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 shadow-xl p-4">
                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                {t('Admin API token', 'Admin API token')} (X-Admin-Token)
                            </p>
                            <Input
                                type="password"
                                value={adminTokenInput}
                                onChange={(e) => setAdminTokenInput(e.target.value)}
                                placeholder={t('הדבק ADMIN_TOKEN', 'Paste ADMIN_TOKEN from .env')}
                                className="font-mono text-xs"
                            />
                        </Card>
                        <Card className="bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 shadow-2xl">
                            <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 dark:border-white/5 pb-6">
                                <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
                                    {t('סנכרון רישיונות', 'License sync health')}
                                </CardTitle>
                                <Button type="button" size="sm" variant="outline" onClick={fetchSyncRuns} disabled={loadingSyncRuns || !token}>
                                    {loadingSyncRuns ? t('טוען...', 'Loading...') : t('רענן', 'Refresh')}
                                </Button>
                            </CardHeader>
                            <CardContent className="pt-6 overflow-x-auto">
                                <Table className="min-w-[640px]">
                                    <TableHeader>
                                        <TableRow className="border-black/5 dark:border-white/5 hover:bg-transparent">
                                            <TableHead className="text-slate-500 dark:text-slate-400 font-black uppercase text-[9px] tracking-widest">Source</TableHead>
                                            <TableHead className="text-slate-500 dark:text-slate-400 font-black uppercase text-[9px] tracking-widest">Status</TableHead>
                                            <TableHead className="text-slate-500 dark:text-slate-400 font-black uppercase text-[9px] tracking-widest">Written</TableHead>
                                            <TableHead className="text-slate-500 dark:text-slate-400 font-black uppercase text-[9px] tracking-widest">Finished</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {syncRuns.length === 0 && !loadingSyncRuns && (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-slate-500 text-sm">
                                                    {t('אין הרצות סנכרון עדיין', 'No sync runs logged yet. Trigger POST /api/admin/open-data/sync.')}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {syncRuns.map((run) => (
                                            <TableRow key={run.id} className="border-black/5 dark:border-white/5">
                                                <TableCell className="font-mono text-[10px] text-slate-700 dark:text-slate-200">
                                                    <span className="flex items-center gap-2 flex-wrap">
                                                        {run.source_id || '—'}
                                                        {run.drift_warning && (
                                                            <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 border-amber-500/30 text-[8px] uppercase">
                                                                {t('סטייה', 'Drift')} {run.drift_warning.drop_pct ?? '?'}%
                                                            </Badge>
                                                        )}
                                                    </span>
                                                </TableCell>
                                                <TableCell>
                                                    <Badge className={run.status === 'success' ? 'bg-emerald-500/10 text-emerald-600' : run.status === 'error' ? 'bg-red-500/10 text-red-500' : 'bg-amber-500/10 text-amber-600'}>
                                                        {run.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-[10px] font-bold">{run.records_written ?? 0} / {run.records_fetched ?? 0}</TableCell>
                                                <TableCell className="text-[10px] text-slate-500">
                                                    {run.finished_at ? new Date(run.finished_at).toLocaleString() : '—'}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                        {syncAlerts.length > 0 && (
                            <Card className="bg-amber-500/5 border-amber-500/20 shadow-xl">
                                <CardHeader className="border-b border-amber-500/10 pb-4">
                                    <CardTitle className="text-xs font-black uppercase tracking-widest text-amber-700 dark:text-amber-400">
                                        {t('התראות סטייה בסנכרון', 'Sync drift alerts')}
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="pt-4 space-y-2">
                                    {syncAlerts.slice(0, 8).map((alert) => (
                                        <div key={alert.id} className="text-[10px] text-slate-600 dark:text-slate-300 font-mono">
                                            <span className="font-bold text-amber-600">{alert.source_id}</span>
                                            {' — '}
                                            {alert.drift_warning?.message || t('ירידה בכמות רשומות', 'Record count drop')}
                                        </div>
                                    ))}
                                </CardContent>
                            </Card>
                        )}
                    </TabsContent>

                    <TabsContent value="comtrade" className="h-full m-0 p-6 overflow-y-auto space-y-6">
                        <Card className="bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 shadow-2xl">
                            <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 dark:border-white/5 pb-6">
                                <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
                                    UN Comtrade HS27
                                </CardTitle>
                                <motion.div className="flex items-center gap-2">
                                    <Input
                                        className="w-20 h-8 text-xs font-mono"
                                        value={comtradeYear}
                                        onChange={(e) => setComtradeYear(e.target.value)}
                                        placeholder="2023"
                                    />
                                    <Button
                                        type="button"
                                        size="sm"
                                        onClick={triggerComtradeSync}
                                        disabled={comtradeSyncing || !resolvedAdminToken}
                                        className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-black uppercase text-[10px]"
                                    >
                                        {comtradeSyncing ? t('מסנכרן...', 'Syncing...') : t('סנכרן', 'Sync now')}
                                    </Button>
                                    <Button type="button" size="sm" variant="outline" onClick={fetchComtradeRuns} disabled={loadingComtrade}>
                                        {t('רענן', 'Refresh')}
                                    </Button>
                                </motion.div>
                            </CardHeader>
                            <CardContent className="pt-6 overflow-x-auto">
                                {!resolvedAdminToken && (
                                    <p className="text-sm text-slate-500 mb-4">
                                        {t('הגדר Admin API token בלשונית Open Data', 'Set Admin API token on the Open Data tab first.')}
                                    </p>
                                )}
                                <Table className="min-w-[560px]">
                                    <TableHeader>
                                        <TableRow className="border-black/5 dark:border-white/5 hover:bg-transparent">
                                            <TableHead className="text-[9px] font-black uppercase tracking-widest text-slate-500">Year</TableHead>
                                            <TableHead className="text-[9px] font-black uppercase tracking-widest text-slate-500">Status</TableHead>
                                            <TableHead className="text-[9px] font-black uppercase tracking-widest text-slate-500">Rows</TableHead>
                                            <TableHead className="text-[9px] font-black uppercase tracking-widest text-slate-500">Finished</TableHead>
                                        </TableRow>
                                    </TableHeader>
                                    <TableBody>
                                        {comtradeRuns.length === 0 && !loadingComtrade && (
                                            <TableRow>
                                                <TableCell colSpan={4} className="text-slate-500 text-sm">
                                                    {t('אין הרצות Comtrade', 'No Comtrade sync runs yet. Requires COMTRADE_API_KEY.')}
                                                </TableCell>
                                            </TableRow>
                                        )}
                                        {comtradeRuns.map((run) => (
                                            <TableRow key={run.id} className="border-black/5 dark:border-white/5">
                                                <TableCell className="font-mono text-[10px]">{run.year ?? '—'}</TableCell>
                                                <TableCell>
                                                    <Badge className={run.status === 'success' ? 'bg-emerald-500/10 text-emerald-600' : 'bg-amber-500/10 text-amber-600'}>
                                                        {run.status}
                                                    </Badge>
                                                </TableCell>
                                                <TableCell className="text-[10px] font-bold">{run.rows_upserted ?? 0}</TableCell>
                                                <TableCell className="text-[10px] text-slate-500">
                                                    {run.finished_at ? new Date(run.finished_at).toLocaleString() : '—'}
                                                </TableCell>
                                            </TableRow>
                                        ))}
                                    </TableBody>
                                </Table>
                            </CardContent>
                        </Card>
                    </TabsContent>

                    <TabsContent value="data-health" className="h-full m-0 p-6 overflow-y-auto space-y-6">
                        <Card className="bg-black/[0.02] dark:bg-white/[0.02] border-black/5 dark:border-white/5 shadow-2xl">
                            <CardHeader className="flex flex-row items-center justify-between border-b border-black/5 dark:border-white/5 pb-6">
                                <CardTitle className="text-xs font-black uppercase tracking-widest text-slate-700 dark:text-slate-200">
                                    {t('בריאות נתונים', 'Data health')}
                                </CardTitle>
                                <Button type="button" size="sm" variant="outline" onClick={fetchDataHealth} disabled={loadingDataHealth || !resolvedAdminToken}>
                                    {loadingDataHealth ? t('טוען...', 'Loading...') : t('רענן', 'Refresh')}
                                </Button>
                            </CardHeader>
                            <CardContent className="pt-6 space-y-6">
                                {!resolvedAdminToken ? (
                                    <p className="text-sm text-slate-500">
                                        {t('נדרש Admin API token', 'Admin API token required.')}
                                    </p>
                                ) : dataHealth ? (
                                    <>
                                        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                            <motion.div className="rounded-xl border border-black/5 dark:border-white/5 p-3">
                                                <p className="text-[9px] uppercase text-slate-500 font-black">Manual edits</p>
                                                <p className="text-lg font-black">{dataHealth.manually_edited_count ?? 0}</p>
                                            </motion.div>
                                            {dataHealth.petroleum_osm_layers &&
                                                Object.entries(dataHealth.petroleum_osm_layers).map(([layer, stats]) => (
                                                    <motion.div key={layer} className="rounded-xl border border-black/5 dark:border-white/5 p-3">
                                                        <p className="text-[9px] uppercase text-slate-500 font-black">OSM {layer}</p>
                                                        <p className="text-lg font-black">{stats.feature_count ?? 0}</p>
                                                    </motion.div>
                                                ))}
                                        </motion.div>
                                        <div>
                                            <p className="text-[10px] font-black uppercase tracking-widest text-slate-500 mb-2">
                                                {t('רישיונות לפי מדינה (20 ראשונות)', 'Licenses by country (top 20)')}
                                            </p>
                                            <div className="max-h-48 overflow-y-auto font-mono text-[10px] space-y-1">
                                                {(dataHealth.license_counts_by_country || []).slice(0, 20).map((row) => (
                                                    <motion.div key={row.country} className="flex justify-between gap-4">
                                                        <span>{row.country}</span>
                                                        <span className="text-amber-600">{row.license_count}</span>
                                                    </motion.div>
                                                ))}
                                            </div>
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm text-slate-500">{t('לחץ רענן', 'Click Refresh to load.')}</p>
                                )}
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

    const DeleteUserDialog = (
        <Dialog
            open={!!userPendingDelete}
            onOpenChange={(open) => {
                if (!open) setUserPendingDelete(null);
            }}
        >
            <DialogContent className="max-w-md bg-slate-900 border-white/10 text-slate-100 shadow-2xl">
                <DialogHeader className="border-b border-white/5 pb-4">
                    <DialogTitle className="text-sm font-black uppercase tracking-widest text-amber-500">
                        {t('מחיקת משתמש', 'Delete user')}
                    </DialogTitle>
                </DialogHeader>
                <p className="text-sm text-slate-300 pt-2">
                    {t('למחוק לצמיתות את', 'Permanently delete')}{' '}
                    <span className="font-bold text-white">{userPendingDelete?.username}</span>?{' '}
                    {t('פעולה זו אינה הפיכה.', 'This cannot be undone.')}
                </p>
                <DialogFooter className="gap-2 sm:gap-0 pt-4">
                    <Button
                        type="button"
                        variant="outline"
                        className="border-white/10"
                        onClick={() => setUserPendingDelete(null)}
                        disabled={deleteSubmitting}
                    >
                        {t('ביטול', 'Cancel')}
                    </Button>
                    <Button
                        type="button"
                        variant="destructive"
                        className="font-black uppercase text-[10px]"
                        onClick={confirmDeleteUser}
                        disabled={deleteSubmitting || !token}
                    >
                        {deleteSubmitting ? t('מוחק...', 'Deleting...') : t('מחק', 'Delete')}
                    </Button>
                </DialogFooter>
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
            {DeleteUserDialog}
            {UserEditorDialog}
        </>
    );

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 bg-slate-950 border-white/10 overflow-hidden shadow-2xl">
                {AdminContent}
            </DialogContent>
            {SecondaryDialogs}
            {DeleteUserDialog}
            {UserEditorDialog}
        </Dialog>
    );
}
