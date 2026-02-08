import { useState, useEffect } from 'react';

const AdminPanel = ({ isOpen, onClose, token }) => {
    const [activeTab, setActiveTab] = useState('users'); // 'users' or 'logs'
    const [users, setUsers] = useState([]);
    const [logs, setLogs] = useState([]);

    // Per-user activity log state
    const [selectedUserForLogs, setSelectedUserForLogs] = useState(null);
    const [userLogs, setUserLogs] = useState([]);
    const [loadingUserLogs, setLoadingUserLogs] = useState(false);

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

    const handleDeleteUser = (id, username) => {
        if (!confirm(`Are you sure you want to delete user '${username}'?`)) return;

        fetch(`${API_BASE}/auth/users/${id}`, { method: 'DELETE' })
            .then(res => {
                if (res.ok) {
                    fetchUsers();
                    setCreateMsg('User deleted.');
                    setTimeout(() => setCreateMsg(''), 3000);
                } else {
                    res.text().then(t => alert('Failed to delete: ' + t));
                }
            })
            .catch(err => alert('Error: ' + err.message));
    };

    const handleEditUser = (u) => {
        const newPass = prompt(`Enter new password for ${u.username} (leave blank to keep current):`);
        const newRole = prompt(`Enter new role for ${u.username} (user/admin):`, u.role);

        if (newPass === null && newRole === null) return; // Cancelled

        const updates = {};
        if (newPass) updates.password = newPass;
        if (newRole && newRole !== u.role) updates.role = newRole;

        if (Object.keys(updates).length === 0) return;

        fetch(`${API_BASE}/auth/users/${u.id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(updates)
        })
            .then(res => {
                if (res.ok) {
                    alert('User updated successfully');
                    fetchUsers();
                } else {
                    alert('Update failed');
                }
            })
            .catch(e => alert(e.message));
    };

    const fetchUserLogs = (user) => {
        setSelectedUserForLogs(user);
        setLoadingUserLogs(true);
        setUserLogs([]);

        fetch(`${API_BASE}/activity/logs/user/${user.id}?limit=200`)
            .then(res => res.json())
            .then(data => {
                setUserLogs(data);
                setLoadingUserLogs(false);
            })
            .catch(err => {
                console.error("Failed to fetch user logs", err);
                setLoadingUserLogs(false);
            });
    };

    const closeUserLogsModal = () => {
        setSelectedUserForLogs(null);
        setUserLogs([]);
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(0,0,0,0.85)',
            backdropFilter: 'blur(4px)',
            zIndex: 10000,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '20px'
        }}>
            <div className="admin-modal" style={{
                backgroundColor: 'var(--bg-color)',
                width: '100%',
                maxWidth: '900px',
                maxHeight: '90vh',
                height: 'auto',
                borderRadius: '12px',
                border: '1px solid var(--border-color)',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '20px',
                    borderBottom: '1px solid var(--border-color)',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    background: 'var(--surface-color)'
                }}>
                    <h2 style={{ margin: 0, color: 'var(--text-color)', fontWeight: 700 }}>Admin Control Panel</h2>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border-color)',
                            color: 'var(--text-muted)',
                            fontSize: '1.5rem',
                            cursor: 'pointer',
                            width: '36px',
                            height: '36px',
                            borderRadius: '6px',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            transition: 'all 0.2s'
                        }}
                        onMouseEnter={(e) => {
                            e.target.style.background = 'rgba(239, 68, 68, 0.15)';
                            e.target.style.borderColor = '#ef4444';
                            e.target.style.color = '#ef4444';
                        }}
                        onMouseLeave={(e) => {
                            e.target.style.background = 'transparent';
                            e.target.style.borderColor = 'var(--border-color)';
                            e.target.style.color = 'var(--text-muted)';
                        }}
                    >
                        ×
                    </button>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', borderBottom: '1px solid var(--border-color)', background: 'var(--bg-color)' }}>
                    <button
                        onClick={() => setActiveTab('users')}
                        style={{
                            flex: 1,
                            padding: '15px',
                            background: activeTab === 'users' ? 'var(--surface-color)' : 'transparent',
                            color: activeTab === 'users' ? 'var(--primary-color)' : 'var(--text-muted)',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            borderBottom: activeTab === 'users' ? '2px solid var(--primary-color)' : '2px solid transparent',
                            transition: 'all 0.2s'
                        }}
                    >
                        👥 User Management
                    </button>
                    <button
                        onClick={() => setActiveTab('logs')}
                        style={{
                            flex: 1,
                            padding: '15px',
                            background: activeTab === 'logs' ? 'var(--surface-color)' : 'transparent',
                            color: activeTab === 'logs' ? 'var(--primary-color)' : 'var(--text-muted)',
                            border: 'none',
                            cursor: 'pointer',
                            fontWeight: 'bold',
                            borderBottom: activeTab === 'logs' ? '2px solid var(--primary-color)' : '2px solid transparent',
                            transition: 'all 0.2s'
                        }}
                    >
                        📜 Activity Logs
                    </button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px', background: 'var(--bg-color)' }}>

                    {/* User Management Tab */}
                    {activeTab === 'users' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '30px' }}>
                            {/* Create User */}
                            <div style={{ background: 'var(--surface-color)', padding: '20px', borderRadius: '8px', border: '1px solid var(--border-color)' }}>
                                <h3 style={{ marginTop: 0, color: 'var(--text-color)' }}>Create New User</h3>
                                <form onSubmit={handleCreateUser} style={{ display: 'flex', gap: '10px', alignItems: 'flex-end', flexWrap: 'wrap' }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '5px' }}>Username</label>
                                        <input
                                            value={newUserUser} onChange={e => setNewUserUser(e.target.value)} required
                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
                                        />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '5px' }}>Password</label>
                                        <input
                                            type="password" value={newUserPass} onChange={e => setNewUserPass(e.target.value)} required
                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)' }}
                                        />
                                    </div>
                                    <div style={{ width: '120px' }}>
                                        <label style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.8rem', marginBottom: '5px' }}>Role</label>
                                        <select
                                            value={newUserRole} onChange={e => setNewUserRole(e.target.value)}
                                            style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid var(--border-color)', background: 'var(--bg-color)', color: 'var(--text-color)', cursor: 'pointer' }}
                                        >
                                            <option value="user">User</option>
                                            <option value="admin">Admin</option>
                                        </select>
                                    </div>
                                    <button
                                        type="submit"
                                        style={{ padding: '8px 20px', background: 'var(--primary-color)', color: '#000', border: 'none', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', transition: 'opacity 0.2s' }}
                                    >
                                        Create
                                    </button>
                                </form>
                                {createMsg && <p style={{ color: createMsg.includes('Error') ? '#ef4444' : '#22c55e', marginTop: '10px' }}>{createMsg}</p>}
                            </div>

                            {/* User List */}
                            <div>
                                <h3 style={{ color: 'var(--text-color)' }}>Existing Users</h3>
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-muted)' }}>
                                        <thead style={{ background: 'var(--surface-color)', textAlign: 'left' }}>
                                            <tr>
                                                <th style={{ padding: '12px' }}>Username</th>
                                                <th style={{ padding: '12px' }}>Role</th>
                                                <th style={{ padding: '12px' }}>Created</th>
                                                <th style={{ padding: '12px', textAlign: 'right' }}>Actions</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {users.map(u => (
                                                <tr key={u.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                                                    <td style={{ padding: '12px', color: 'var(--text-color)' }}>{u.username}</td>
                                                    <td style={{ padding: '12px' }}>{u.role}</td>
                                                    <td style={{ padding: '12px' }}>{new Date(u.created_at).toLocaleDateString()}</td>
                                                    <td style={{ padding: '12px', textAlign: 'right', display: 'flex', gap: '10px', justifyContent: 'flex-end' }}>
                                                        <button
                                                            onClick={() => fetchUserLogs(u)}
                                                            style={{ background: '#3b82f6', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer', fontWeight: 'bold' }}
                                                        >
                                                            📊 Activity
                                                        </button>
                                                        <button
                                                            onClick={() => handleEditUser(u)}
                                                            style={{ background: 'var(--primary-color)', color: '#000', border: 'none', padding: '5px 10px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', transition: 'opacity 0.2s' }}
                                                        >
                                                            ✏️ Edit
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteUser(u.id, u.username)}
                                                            style={{ background: '#ef4444', color: 'white', border: 'none', padding: '5px 10px', borderRadius: '4px', cursor: 'pointer' }}
                                                        >
                                                            🗑️
                                                        </button>
                                                    </td>
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
                            <h3 style={{ color: 'var(--text-color)', marginTop: 0 }}>Recent System Activity</h3>
                            <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                    <thead style={{ background: 'var(--surface-color)', textAlign: 'left' }}>
                                        <tr>
                                            <th style={{ padding: '12px' }}>Time</th>
                                            <th style={{ padding: '12px' }}>User</th>
                                            <th style={{ padding: '12px' }}>Action</th>
                                            <th style={{ padding: '12px' }}>Details</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {logs.map(log => (
                                            <tr key={log.id} style={{ borderTop: '1px solid var(--border-color)' }}>
                                                <td style={{ padding: '10px' }}>{new Date(log.timestamp).toLocaleString()}</td>
                                                <td style={{ padding: '10px', color: 'var(--text-color)' }}>{log.username}</td>
                                                <td style={{ padding: '10px', color: 'var(--primary-color)' }}>{log.action}</td>
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

            {/* Per-User Activity Log Modal */}
            {selectedUserForLogs && (
                <div style={{
                    position: 'fixed',
                    top: 0,
                    left: 0,
                    width: '100vw',
                    height: '100vh',
                    backgroundColor: 'rgba(0,0,0,0.9)',
                    backdropFilter: 'blur(4px)',
                    zIndex: 10001,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: '20px'
                }}>
                    <div style={{
                        backgroundColor: 'var(--bg-color)',
                        width: '100%',
                        maxWidth: '1000px',
                        maxHeight: '90vh',
                        borderRadius: '12px',
                        border: '1px solid var(--border-color)',
                        display: 'flex',
                        flexDirection: 'column',
                        overflow: 'hidden',
                        boxShadow: '0 20px 60px rgba(0, 0, 0, 0.6)'
                    }}>
                        {/* Header */}
                        <div style={{
                            padding: '20px',
                            borderBottom: '1px solid var(--border-color)',
                            display: 'flex',
                            justifyContent: 'space-between',
                            alignItems: 'center',
                            background: 'var(--surface-color)'
                        }}>
                            <div>
                                <h2 style={{ margin: 0, color: 'var(--text-color)', display: 'flex', alignItems: 'center', gap: '10px' }}>
                                    <span>📊</span>
                                    Activity Log: {selectedUserForLogs.username}
                                </h2>
                                <p style={{ margin: '5px 0 0 0', color: 'var(--text-muted)', fontSize: '0.9em' }}>
                                    Role: {selectedUserForLogs.role} | Total Activities: {userLogs.length}
                                </p>
                            </div>
                            <button
                                onClick={closeUserLogsModal}
                                style={{
                                    background: 'transparent',
                                    border: '1px solid var(--border-color)',
                                    color: 'var(--text-muted)',
                                    fontSize: '1.5rem',
                                    cursor: 'pointer',
                                    width: '40px',
                                    height: '40px',
                                    borderRadius: '6px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    transition: 'all 0.2s'
                                }}
                                onMouseEnter={(e) => {
                                    e.target.style.background = 'rgba(239, 68, 68, 0.2)';
                                    e.target.style.color = '#ef4444';
                                }}
                                onMouseLeave={(e) => {
                                    e.target.style.background = 'transparent';
                                    e.target.style.color = 'var(--text-muted)';
                                }}
                            >
                                ×
                            </button>
                        </div>

                        {/* Activity Summary Stats */}
                        <div style={{
                            padding: '15px 20px',
                            borderBottom: '1px solid var(--border-color)',
                            background: 'var(--surface-color)',
                            display: 'flex',
                            gap: '20px',
                            flexWrap: 'wrap'
                        }}>
                            {(() => {
                                const actionCounts = {};
                                userLogs.forEach(log => {
                                    actionCounts[log.action] = (actionCounts[log.action] || 0) + 1;
                                });

                                const topActions = Object.entries(actionCounts)
                                    .sort((a, b) => b[1] - a[1])
                                    .slice(0, 5);

                                return topActions.map(([action, count]) => (
                                    <div key={action} style={{
                                        background: 'var(--bg-color)',
                                        padding: '10px 15px',
                                        borderRadius: '6px',
                                        border: '1px solid var(--border-color)',
                                        flex: '1 1 150px'
                                    }}>
                                        <div style={{ color: 'var(--text-muted)', fontSize: '0.75em', marginBottom: '3px' }}>
                                            {action}
                                        </div>
                                        <div style={{ color: 'var(--primary-color)', fontSize: '1.3em', fontWeight: 'bold' }}>
                                            {count}
                                        </div>
                                    </div>
                                ));
                            })()}
                        </div>

                        {/* Logs Table */}
                        <div style={{ flex: 1, overflowY: 'auto', padding: '20px' }}>
                            {loadingUserLogs ? (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '100%',
                                    color: 'var(--text-muted)'
                                }}>
                                    <div>Loading activity logs...</div>
                                </div>
                            ) : userLogs.length === 0 ? (
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '100%',
                                    color: 'var(--text-muted)',
                                    flexDirection: 'column',
                                    gap: '10px'
                                }}>
                                    <div style={{ fontSize: '3em' }}>📭</div>
                                    <div>No activity recorded for this user yet</div>
                                </div>
                            ) : (
                                <div style={{ border: '1px solid var(--border-color)', borderRadius: '8px', overflow: 'hidden' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
                                        <thead style={{ background: 'var(--surface-color)', textAlign: 'left', position: 'sticky', top: 0 }}>
                                            <tr>
                                                <th style={{ padding: '12px', width: '180px' }}>Timestamp</th>
                                                <th style={{ padding: '12px', width: '150px' }}>Action</th>
                                                <th style={{ padding: '12px' }}>Details</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {userLogs.map((log, idx) => (
                                                <tr
                                                    key={log.id || idx}
                                                    style={{
                                                        borderTop: '1px solid var(--border-color)',
                                                        background: idx % 2 === 0 ? 'transparent' : 'var(--surface-color)'
                                                    }}
                                                >
                                                    <td style={{ padding: '10px', color: 'var(--text-color)', fontSize: '0.85em' }}>
                                                        {new Date(log.timestamp).toLocaleString()}
                                                    </td>
                                                    <td style={{ padding: '10px' }}>
                                                        <span style={{
                                                            background: log.action.includes('DELETE') ? 'rgba(239, 68, 68, 0.2)' :
                                                                log.action.includes('CREATE') || log.action.includes('IMPORT') ? 'rgba(34, 197, 94, 0.2)' :
                                                                    log.action.includes('UPDATE') || log.action.includes('EXPORT') ? 'rgba(251, 191, 36, 0.2)' :
                                                                        'rgba(59, 130, 246, 0.2)',
                                                            color: log.action.includes('DELETE') ? '#ef4444' :
                                                                log.action.includes('CREATE') || log.action.includes('IMPORT') ? '#22c55e' :
                                                                    log.action.includes('UPDATE') || log.action.includes('EXPORT') ? '#fbbf24' :
                                                                        '#3b82f6',
                                                            padding: '4px 8px',
                                                            borderRadius: '4px',
                                                            fontSize: '0.8em',
                                                            fontWeight: 'bold',
                                                            display: 'inline-block'
                                                        }}>
                                                            {log.action}
                                                        </span>
                                                    </td>
                                                    <td style={{ padding: '10px', color: '#e2e8f0' }}>
                                                        {log.details || '-'}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default AdminPanel;
