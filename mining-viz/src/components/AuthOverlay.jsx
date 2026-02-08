import { useState } from 'react';

const AuthOverlay = ({ onLogin, error }) => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');

    const handleSubmit = (e) => {
        e.preventDefault();
        onLogin(username, password);
    };

    return (
        <div style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            backgroundColor: 'rgba(15, 23, 42, 0.2)', // Very transparent
            backdropFilter: 'blur(2px)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexDirection: 'column'
        }}>
            <div style={{
                background: '#1e293b',
                padding: '40px',
                borderRadius: '16px',
                width: '90%',
                maxWidth: '400px',
                boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.25)',
                border: '1px solid #334155'
            }}>
                <h2 style={{ color: 'white', textAlign: 'center', marginBottom: '20px', fontSize: '1.5rem' }}>
                    Mining Map Access
                </h2>
                <p style={{ color: '#94a3b8', textAlign: 'center', marginBottom: '30px', fontSize: '0.9rem' }}>
                    Please sign in to view and manage license data.
                </p>

                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '15px' }}>
                    <div>
                        <input
                            type="text"
                            placeholder="Username"
                            value={username}
                            onChange={(e) => setUsername(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid #475569',
                                background: '#0f172a',
                                color: 'white',
                                outline: 'none'
                            }}
                        />
                    </div>
                    <div>
                        <input
                            type="password"
                            placeholder="Password"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            style={{
                                width: '100%',
                                padding: '12px',
                                borderRadius: '8px',
                                border: '1px solid #475569',
                                background: '#0f172a',
                                color: 'white',
                                outline: 'none'
                            }}
                        />
                    </div>

                    {error && (
                        <div style={{ color: '#ef4444', fontSize: '0.85rem', textAlign: 'center' }}>
                            {error}
                        </div>
                    )}

                    <button
                        type="submit"
                        style={{
                            width: '100%',
                            padding: '12px',
                            background: '#fbbf24', // Gold
                            color: '#000',
                            border: 'none',
                            borderRadius: '8px',
                            fontSize: '1rem',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            marginTop: '10px',
                            transition: 'opacity 0.2s'
                        }}
                    >
                        Sign In
                    </button>
                </form>
            </div>

            <p style={{ marginTop: '20px', color: '#64748b', fontSize: '0.8rem' }}>
                Protected System &bull; Authorized Personnel Only
            </p>
        </div>
    );
};

export default AuthOverlay;
