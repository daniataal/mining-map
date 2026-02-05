import React from 'react';

const SkeletonLoader = ({ count = 3 }) => {
    return (
        <div className="skeleton-container" style={{ padding: '20px', display: 'flex', flexDirection: 'column', gap: '15px' }}>
            {[...Array(count)].map((_, i) => (
                <div key={i} className="skeleton-item" style={{
                    backgroundColor: '#1e293b',
                    padding: '15px',
                    borderRadius: '8px',
                    border: '1px solid #334155'
                }}>
                    <div style={{
                        height: '24px', width: '70%', backgroundColor: '#334155', borderRadius: '4px', marginBottom: '10px',
                        animation: 'pulse 1.5s infinite ease-in-out'
                    }}></div>
                    <div style={{
                        height: '16px', width: '40%', backgroundColor: '#334155', borderRadius: '4px', marginBottom: '8px',
                        animation: 'pulse 1.5s infinite ease-in-out'
                    }}></div>
                    <div style={{
                        height: '16px', width: '30%', backgroundColor: '#334155', borderRadius: '4px',
                        animation: 'pulse 1.5s infinite ease-in-out'
                    }}></div>
                </div>
            ))}
            <style>{`
                @keyframes pulse {
                    0% { opacity: 0.6; }
                    50% { opacity: 0.8; }
                    100% { opacity: 0.6; }
                }
            `}</style>
        </div>
    );
};

export default SkeletonLoader;
