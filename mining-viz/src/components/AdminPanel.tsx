import { useState, useEffect } from 'react';
import { useI18n } from '../lib/i18n';
import { User, ActivityLog, MeetingPoint, MinerListing } from '../types';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Tabs, TabsList, TabsTrigger, TabsContent } from './ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from './ui/table';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from './ui/dialog';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { LucideUsers, LucideHistory, LucideMapPin, LucidePickaxe, LucidePlus, LucideTrash2, LucideEdit, LucideChartBar } from 'lucide-react';

interface AdminPanelProps {
  isOpen: boolean;
  onClose: () => void;
  token?: string;
}

export default function AdminPanel({ isOpen, onClose, token }: AdminPanelProps) {
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

    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

    const fetchData = async (endpoint: string, setter: (val: any) => void) => {
        try {
            const res = await fetch(`${API_BASE}${endpoint}`);
            const data = await res.json();
            setter(data);
        } catch (err) {
            console.error(`Failed to fetch ${endpoint}`, err);
        }
    };

    useEffect(() => {
        if (isOpen) {
            fetchData('/auth/users', setUsers);
            fetchData('/activity/logs?limit=100', setLogs);
            fetchData('/meeting-points', setMeetingPoints);
            fetchData('/miner-listings', setMinerListings);
        }
    }, [isOpen]);

    const fetchUserLogs = async (user: User) => {
        setSelectedUserForLogs(user);
        setLoadingUserLogs(true);
        try {
            const res = await fetch(`${API_BASE}/activity/logs/user/${user.id}?limit=200`);
            const data = await res.json();
            setUserLogs(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error("Failed to fetch user logs", err);
            setUserLogs([]);
        } finally {
            setLoadingUserLogs(false);
        }
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="max-w-5xl h-[90vh] flex flex-col p-0 bg-slate-950 border-slate-800 overflow-hidden">
                <DialogHeader className="p-6 border-b border-slate-800 bg-slate-900/50">
                    <DialogTitle className="text-2xl font-bold flex items-center gap-2">
                        <span className="text-amber-500">🛡️</span>
                        {t("לוח בקרה למנהלים", "Admin Control Panel")}
                    </DialogTitle>
                </DialogHeader>

                <Tabs value={activeTab} onValueChange={setActiveTab} className="flex-1 flex flex-col overflow-hidden">
                    <div className="px-6 border-b border-slate-800 bg-slate-900/30">
                        <TabsList className="bg-transparent h-14 w-full justify-start gap-4 p-0">
                            <TabsTrigger value="users" className="data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-4 gap-2">
                                <LucideUsers className="w-4 h-4" /> {t("משתמשים", "Users")}
                            </TabsTrigger>
                            <TabsTrigger value="logs" className="data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-4 gap-2">
                                <LucideHistory className="w-4 h-4" /> {t("יומנים", "Logs")}
                            </TabsTrigger>
                            <TabsTrigger value="meeting-points" className="data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-4 gap-2">
                                <LucideMapPin className="w-4 h-4" /> {t("נקודות מפגש", "Meeting Points")}
                            </TabsTrigger>
                            <TabsTrigger value="miner-listings" className="data-[state=active]:bg-transparent data-[state=active]:text-amber-500 data-[state=active]:border-b-2 border-amber-500 rounded-none h-full px-4 gap-2">
                                <LucidePickaxe className="w-4 h-4" /> {t("מודעות כורים", "Miner Listings")}
                            </TabsTrigger>
                        </TabsList>
                    </div>

                    <div className="flex-1 overflow-hidden">
                        <TabsContent value="users" className="h-full m-0 p-6 overflow-y-auto space-y-8">
                            <Card className="bg-slate-900/50 border-slate-800">
                                <CardHeader className="flex flex-row items-center justify-between">
                                    <CardTitle className="text-lg">{t("ניהול משתמשים", "User Management")}</CardTitle>
                                    <Button size="sm" className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold">
                                        <LucidePlus className="w-4 h-4 mr-1" /> {t("משתמש חדש", "New User")}
                                    </Button>
                                </CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-slate-800 hover:bg-transparent">
                                                <TableHead className="text-slate-500">{t("משתמש", "Username")}</TableHead>
                                                <TableHead className="text-slate-500">{t("תפקיד", "Role")}</TableHead>
                                                <TableHead className="text-slate-500">{t("נוצר בתאריך", "Created")}</TableHead>
                                                <TableHead className="text-right text-slate-500">{t("פעולות", "Actions")}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {users.map(u => (
                                                <TableRow key={u.id} className="border-slate-800 hover:bg-slate-800/30">
                                                    <TableCell className="font-medium text-slate-200">{u.username}</TableCell>
                                                    <TableCell>
                                                        <Badge variant={u.role === 'admin' ? 'default' : 'secondary'} className={u.role === 'admin' ? 'bg-amber-500/10 text-amber-500 hover:bg-amber-500/20' : 'bg-slate-800 text-slate-400'}>
                                                            {u.role}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-slate-400 text-xs">{new Date(u.created_at).toLocaleDateString()}</TableCell>
                                                    <TableCell className="text-right space-x-2">
                                                        <Button variant="outline" size="sm" onClick={() => fetchUserLogs(u)} className="h-8 border-slate-700 hover:bg-slate-800 text-[10px]">
                                                            <LucideChartBar className="w-3 h-3 mr-1" /> {t("פעילות", "Activity")}
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-slate-200">
                                                            <LucideEdit className="w-3 h-3" />
                                                        </Button>
                                                        <Button variant="ghost" size="icon" className="h-8 w-8 text-slate-500 hover:text-red-500">
                                                            <LucideTrash2 className="w-3 h-3" />
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
                            <Card className="bg-slate-900/50 border-slate-800">
                                <CardHeader>
                                    <CardTitle className="text-lg">{t("פעילות מערכת אחרונה", "Recent System Activity")}</CardTitle>
                                </CardHeader>
                                <CardContent>
                                    <Table>
                                        <TableHeader>
                                            <TableRow className="border-slate-800 hover:bg-transparent">
                                                <TableHead className="text-slate-500">{t("זמן", "Time")}</TableHead>
                                                <TableHead className="text-slate-500">{t("משתמש", "User")}</TableHead>
                                                <TableHead className="text-slate-500">{t("פעולה", "Action")}</TableHead>
                                                <TableHead className="text-slate-500">{t("פרטים", "Details")}</TableHead>
                                            </TableRow>
                                        </TableHeader>
                                        <TableBody>
                                            {logs.map(log => (
                                                <TableRow key={log.id} className="border-slate-800 hover:bg-slate-800/30">
                                                    <TableCell className="text-xs text-slate-400">{new Date(log.timestamp).toLocaleString()}</TableCell>
                                                    <TableCell className="font-medium text-slate-300">{log.username}</TableCell>
                                                    <TableCell>
                                                        <Badge className="bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 border-none text-[10px]">
                                                            {log.action}
                                                        </Badge>
                                                    </TableCell>
                                                    <TableCell className="text-slate-500 text-xs">{log.details}</TableCell>
                                                </TableRow>
                                            ))}
                                        </TableBody>
                                    </Table>
                                </CardContent>
                            </Card>
                        </TabsContent>
                        
                        <TabsContent value="meeting-points" className="h-full m-0 p-6">
                            <p className="text-slate-500 text-sm text-center py-20 italic">{t("ניהול נקודות מפגש בקרוב...", "Meeting Point management coming soon...")}</p>
                        </TabsContent>

                        <TabsContent value="miner-listings" className="h-full m-0 p-6">
                            <p className="text-slate-500 text-sm text-center py-20 italic">{t("ניהול מודעות כורים בקרוב...", "Miner listing management coming soon...")}</p>
                        </TabsContent>
                    </div>
                </Tabs>
            </DialogContent>

            {/* Per-User Activity Dialog */}
            <Dialog open={!!selectedUserForLogs} onOpenChange={() => setSelectedUserForLogs(null)}>
                <DialogContent className="max-w-3xl h-[80vh] flex flex-col bg-slate-900 border-slate-800">
                    <DialogHeader>
                        <DialogTitle>
                            {t("יומן פעילות:", "Activity Log:")} {selectedUserForLogs?.username}
                        </DialogTitle>
                    </DialogHeader>
                    <div className="flex-1 overflow-y-auto py-4">
                        {loadingUserLogs ? (
                            <div className="h-full flex items-center justify-center text-slate-500">{t("טוען...", "Loading...")}</div>
                        ) : (
                            <Table>
                                <TableHeader>
                                    <TableRow className="border-slate-800">
                                        <TableHead>{t("זמן", "Time")}</TableHead>
                                        <TableHead>{t("פעולה", "Action")}</TableHead>
                                        <TableHead>{t("פרטים", "Details")}</TableHead>
                                    </TableRow>
                                </TableHeader>
                                <TableBody>
                                    {userLogs.map((log, idx) => (
                                        <TableRow key={idx} className="border-slate-800">
                                            <TableCell className="text-[10px] text-slate-500">{new Date(log.timestamp).toLocaleString()}</TableCell>
                                            <TableCell>
                                                <Badge className="text-[9px] bg-slate-800 text-slate-300">{log.action}</Badge>
                                            </TableCell>
                                            <TableCell className="text-xs text-slate-400">{log.details}</TableCell>
                                        </TableRow>
                                    ))}
                                </TableBody>
                            </Table>
                        )}
                    </div>
                </DialogContent>
            </Dialog>
        </Dialog>
    );
}
