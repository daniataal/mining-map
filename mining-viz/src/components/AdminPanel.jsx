import { useState, useEffect } from 'react';

const AdminPanel = ({ isOpen, onClose, token }) => {
    const [activeTab, setActiveTab] = useState('users'); // 'users' or 'logs'
    const [users, setUsers] = useState([]);
    const [logs, setLogs] = useState([]);

    // Create User Form State
    const [newUserUser, setNewUserUser] = useState('');
    const [newUserPass, setNewUserPass] = useState('');
    const [newUserRole, setNewUserRole] = useState('user');
    const [createMsg, setCreateMsg] = useState('');

    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

    useEffect(() => {
        if (isOpen && token) {
            fetchUsers();
            fetchLogs();
        }
    }, [isOpen, token]);

    const fetchUsers = () => {
        fetch(`${API_BASE}/auth/users`)
            .then(res => res.json())
            .then(data => setUsers(data))
            .catch(err => console.error("Failed to fetch users", err));
    };

    const fetchLogs = () => {
        // Only fetch last 100
        fetch(`${API_BASE}/activity/logs?limit=100`)
            .then(res => res.json())
            .then(data => setLogs(data))
            .catch(err => console.error("Failed to fetch logs", err));
    };

    const handleCreateUser = (e) => {
        e.preventDefault();
        fetch(`${API_BASE}/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: newUserUser, password: newUserPass, role: newUserRole })
        })
            .then(async res => {
                if (res.ok) {
                    setCreateMsg('User created successfully!');
                    setNewUserUser('');
                    setNewUserPass('');
                    fetchUsers();
                    setTimeout(() => setCreateMsg(''), 3000);
                } else {
                    const text = await res.text();
                    setCreateMsg('Error: ' + text);
                }
            })
            .catch(err => setCreateMsg('Error: ' + err.message));
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0,0,0,0.8)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
        }}>
            <div className="admin-modal" style={{
                backgroundColor: '#1e293b',
                width: '100%',
                maxWidth: '900px',
                height: '80vh',
                borderRadius: '12px',
                border: '1px solid #334155',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden'
            }}>
                {/* Header */}
                <div style={{ padding: '20px', borderBottom: '1px solid #334155', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h2 style={{ margin: 0, color: 'white' }}>Admin Control Panel</h2>
                    <button
                        onClick={onClose}
                        style={{ background: 'transparent', border: 'none', color: '#94a3b8', fontSize: '1.5rem', cursor: 'pointer' }}
                    >
                        &times;
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid #334155', background: '#0f172a' }}>
                    <button
                        onClick={() => setActiveTab('users')}
                        style={{
                            flex: 1, padding: '15px', background: activeTab === 'users' ? '#1e293b' : 'transparent',
                            color: activeTab === 'users' ? '#3b82f6' : '#94a3b8', border: 'none', cursor: 'pointer', fontWeight: 'bold'
                        }}
                    >
                        👥 User Management
                    </button>
                    <button
                        onClick={() => setActiveTab('logs')}
                        style={{
                            flex: 1, padding: '15px', background: activeTab === 'logs' ? '#1e293b' : 'transparent',
                            color: activeTab === 'logs' ? '#3b82f6' : '#94a3b8', border: 'none', cursor: 'pointer', fontWeight: 'bold'
                        }}
                    >
                        📜 Activity Logs
                    </button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>

                    {/* User Management Tab */}
                    {activeTab === 'users' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                            {/* Create User */}
                            <div style={{ background: '#0f172a', padding: '20px', borderRadius: '8px', border: '1px solid #334155' }}>
                                <h3 style={{ marginTop: 0, color: '#e2e8f0' }}>Create New User</h3>
                                <form onSubmit={handleCreateUser} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: '5px' }}>Username</label>
                                        <input
                                            value={newUserUser} onChange={e => setNewUserUser(e.target.value)} required
                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#1e293b', color: 'white' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: '5px' }}>Password</label>
                                        <input
                                            type="password" value={newUserPass} onChange={e => setNewUserPass(e.target.value)} required
                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#1e293b', color: 'white' }}
                                        />
                                    </div>
                                    <div style={{ width: '120px' }}>
                                        <label style={{ display: 'block', color: '#94a3b8', fontSize: '0.8rem', marginBottom: '5px' }}>Role</label>
                                        <select
                                            value={newUserRole} onChange={e => setNewUserRole(e.target.value)}
                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#1e293b', color: 'white' }}
                                        >
                                            <option value="user">User</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                    <button
                                        type="submit"
                                        style={{ padding: '8px 20px', background: '#3b82f6', color: 'white', border: 'none', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                                    >
                                        Create
                                    </button>
                                </form>
                                {createMsg && <p style={{ color: createMsg.includes('Error') ? '#ef4444' : '#22c55e', marginTop: '10px' }}>{createMsg}</p>}
                            </div>

                            {/* User List */}
                            <div>
                                <h3 style={{ color: '#e2e8f0' }}>Existing Users</h3>
                                <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', color: '#94a3b8' }}>
                                        <thead style={{ background: '#0f172a', textAlign: 'left' }}>
                                            <tr>
                                                <th style={{ padding: '12px' }}>Username</th>
                                                <th style={{ padding: '12px' }}>Role</th>
                                                <th style={{ padding: '12px' }}>Created</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {users.map(u => (
                                                <tr key={u.id} style={{ borderTop: '1px solid #334155' }}>
                                                    <td style={{ padding: '12px', color: 'white' }}>{u.username}</td>
                                                    <td style={{ padding: '12px' }}>{u.role}</td>
                                                    <td style={{ padding: '12px' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Logs Tab */}
                    {activeTab === 'logs' && (
                        <div>
                            <h3 style={{ color: '#e2e8f0', marginTop: 0 }}>Recent System Activity</h3>
                            <div style={{ border: '1px solid #334155', borderRadius: '8px', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', color: '#94a3b8', fontSize: '0.9rem' }}>
                                    <thead style={{ background: '#0f172a', textAlign: 'left' }}>
                                        <tr>
                                            <th style={{ padding: '12px' }}>Time</th>
                                            <th style={{ padding: '12px' }}>User</th>
                                            <th style={{ padding: '12px' }}>Action</th>
                                            <th style={{ padding: '12px' }}>Details</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {logs.map(log => (
                                            <tr key={log.id} style={{ borderTop: '1px solid #334155' }}>
                                                <td style={{ padding: '10px' }}>{new Date(log.timestamp).toLocaleString()}</td>
                                                <td style={{ padding: '10px', color: '#fff' }}>{log.username}</td>
                                                <td style={{ padding: '10px', color: '#3b82f6' }}>{log.action}</td>
                                                <td style={{ padding: '10px' }}>{log.details || '-'}</td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default AdminPanel;
