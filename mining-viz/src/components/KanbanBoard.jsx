import { useState } from 'react';

const KanbanBoard = ({ processedData, userAnnotations, updateAnnotation, commodities, onCardClick, isMobile }) => {
    const stages = ['New', 'Contacted', 'Diligence', 'Verified', 'Closed'];
    const [activeStage, setActiveStage] = useState('New');

    // Helper to get stage for an item
    const getStage = (id) => {
        return userAnnotations[id]?.stage || 'New';
    };

    // Group items by stage
    const columns = stages.reduce((acc, stage) => {
        acc[stage] = processedData.filter(item => getStage(item.id) === stage);
        return acc;
    }, {});

    const getStageColor = (stage) => {
        switch (stage) {
            case 'New': return '#94a3b8';
            case 'Contacted': return '#3b82f6';
            case 'Diligence': return '#fbbf24';
            case 'Verified': return '#22c55e';
            case 'Closed': return '#64748b';
            default: return '#94a3b8';
        }
    };

    const stagesToRender = isMobile ? [activeStage] : stages;

    return (
        <div className="kanban-board" style={{
            flex: 1,
            height: '100%',
            overflow: 'hidden', // Prevent outer scrolling
            padding: '20px',
            backgroundColor: 'var(--bg-color)',
            display: 'flex',
            flexDirection: 'column', // Always column, we handle inner layout responsive
            gap: '20px',
            paddingBottom: isMobile ? '80px' : '20px'
        }}>

            {/* Mobile Tab Selector */}
            {isMobile && (
                <div style={{
                    display: 'flex',
                    gap: '10px',
                    overflowX: 'auto',
                    flexShrink: 0, // Don't shrink
                    paddingBottom: '5px',
                    marginBottom: '5px',
                    scrollbarWidth: 'none',
                    msOverflowStyle: 'none'
                }}>
                    {stages.map(stage => {
                        const isActive = activeStage === stage;
                        const color = getStageColor(stage);
                        return (
                            <button
                                key={stage}
                                onClick={() => setActiveStage(stage)}
                                style={{
                                    padding: '8px 16px',
                                    borderRadius: '20px',
                                    border: `1px solid ${isActive ? color : 'var(--border-color)'}`,
                                    backgroundColor: isActive ? `${color}20` : 'transparent',
                                    color: isActive ? color : 'var(--text-muted)',
                                    fontWeight: isActive ? 'bold' : 'normal',
                                    whiteSpace: 'nowrap',
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    fontSize: '0.9rem'
                                }}
                            >
                                {stage} ({columns[stage].length})
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Content Container */}
            <div style={{
                flex: 1,
                display: 'flex',
                flexDirection: isMobile ? 'column' : 'row',
                gap: '20px',
                overflowX: isMobile ? 'hidden' : 'auto',
                overflowY: isMobile ? 'hidden' : 'hidden' // Inner columns handle Y scroll
            }}>
                {stagesToRender.map(stage => (
                    <div key={stage} style={{
                        minWidth: isMobile ? '100%' : '280px',
                        width: isMobile ? '100%' : '280px',
                        display: 'flex',
                        flexDirection: 'column',
                        height: '100%', // Take full height of container
                        animation: isMobile ? 'fadeIn 0.3s ease' : 'none'
                    }}>
                        {/* Column Header */}
                        <div style={{
                            padding: '10px 15px',
                            borderRadius: '6px',
                            marginBottom: '15px',
                            backgroundColor: 'var(--card-bg)',
                            border: '1px solid var(--border-color)',
                            borderTop: `4px solid ${getStageColor(stage)}`,
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            flexShrink: 0
                        }}>
                            <h3 style={{ margin: 0, color: '#e6edf3', fontSize: '1rem', fontFamily: 'serif' }}>{stage}</h3>
                            <span style={{ fontSize: '0.8rem', backgroundColor: 'rgba(255,255,255,0.05)', padding: '2px 8px', borderRadius: '10px', color: '#8b949e' }}>
                                {columns[stage].length}
                            </span>
                        </div>

                        {/* Cards - This is the scrollable part */}
                        <div style={{
                            flex: 1,
                            overflowY: 'auto',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            paddingRight: '5px' // Space for scrollbar
                        }}>
                            {columns[stage].map(item => {
                                const annotation = userAnnotations[item.id] || {};
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => onCardClick(item)}
                                        className="mining-card"
                                        style={{
                                            padding: '12px',
                                            cursor: 'pointer',
                                            flexShrink: 0,
                                            margin: 0 // Reset override
                                        }}
                                        onMouseOver={(e) => !isMobile && (e.currentTarget.style.transform = 'translateY(-2px)')}
                                        onMouseOut={(e) => !isMobile && (e.currentTarget.style.transform = 'none')}
                                    >
                                        <div style={{ fontWeight: 'bold', color: '#e6edf3', marginBottom: '4px', fontFamily: 'serif' }}>{item.company}</div>
                                        <div style={{ fontSize: '0.8rem', color: '#8b949e', marginBottom: '8px' }}>{annotation.commodity || item.commodity}</div>

                                        {/* Simple separator */}
                                        <div style={{ height: '1px', background: 'var(--border-color)', margin: '8px 0' }}></div>

                                        {/* Mini Tags */}
                                        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                            {annotation.status === 'good' && <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '10px', backgroundColor: 'rgba(34, 197, 94, 0.15)', color: '#4ade80', border: '1px solid rgba(34, 197, 94, 0.3)' }}>GO</span>}
                                            {annotation.verification?.siteVisit && <span style={{ fontSize: '0.7rem', padding: '2px 6px', borderRadius: '10px', backgroundColor: 'rgba(56, 189, 248, 0.15)', color: '#38bdf8', border: '1px solid rgba(56, 189, 248, 0.3)' }}>Visited</span>}
                                        </div>
                                    </div>
                                );
                            })}
                            {columns[stage].length === 0 && <div style={{ color: '#8b949e', fontSize: '0.9rem', fontStyle: 'italic', padding: '10px', textAlign: 'center' }}>No items in this stage</div>}
                        </div>
                    </div>
                ))}
            </div>

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; transform: translateY(5px); }
                    to { opacity: 1; transform: translateY(0); }
                }
            `}</style>
        </div>
    );
};

export default KanbanBoard;
