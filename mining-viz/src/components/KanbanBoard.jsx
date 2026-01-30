
const KanbanBoard = ({ processedData, userAnnotations, updateAnnotation, commodities, onCardClick }) => {
    const stages = ['New', 'Contacted', 'Diligence', 'Verified', 'Closed'];

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

    return (
        <div className="kanban-board" style={{ flex: 1, overflowX: 'auto', padding: '20px', backgroundColor: '#0f172a', display: 'flex', gap: '20px' }}>
            {stages.map(stage => (
                <div key={stage} style={{ minWidth: '280px', width: '280px', display: 'flex', flexDirection: 'column' }}>
                    {/* Column Header */}
                    <div style={{
                        padding: '10px 15px',
                        borderRadius: '6px',
                        marginBottom: '15px',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        borderTop: `4px solid ${getStageColor(stage)}`,
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                    }}>
                        <h3 style={{ margin: 0, color: 'white', fontSize: '1rem' }}>{stage}</h3>
                        <span style={{ fontSize: '0.8rem', backgroundColor: 'rgba(255,255,255,0.1)', padding: '2px 8px', borderRadius: '10px', color: '#cbd5e1' }}>
                            {columns[stage].length}
                        </span>
                    </div>

                    {/* Cards */}
                    <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
                        {columns[stage].map(item => {
                            const annotation = userAnnotations[item.id] || {};
                            return (
                                <div
                                    key={item.id}
                                    onClick={() => onCardClick(item)}
                                    style={{
                                        backgroundColor: '#1e293b',
                                        padding: '12px',
                                        borderRadius: '6px',
                                        border: '1px solid #334155',
                                        cursor: 'pointer',
                                        boxShadow: '0 2px 4px rgba(0,0,0,0.2)',
                                        transition: 'transform 0.1s'
                                    }}
                                    onMouseOver={(e) => e.currentTarget.style.transform = 'translateY(-2px)'}
                                    onMouseOut={(e) => e.currentTarget.style.transform = 'none'}
                                >
                                    <div style={{ fontWeight: 'bold', color: 'white', marginBottom: '4px' }}>{item.company}</div>
                                    <div style={{ fontSize: '0.8rem', color: '#94a3b8', marginBottom: '8px' }}>{annotation.commodity || item.commodity}</div>

                                    {/* Mini Tags */}
                                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                        {annotation.status === 'good' && <span style={{ fontSize: '0.7rem', padding: '2px 4px', borderRadius: '4px', backgroundColor: 'rgba(34, 197, 94, 0.2)', color: '#4ade80' }}>GO</span>}
                                        {annotation.verification?.siteVisit && <span style={{ fontSize: '0.7rem', padding: '2px 4px', borderRadius: '4px', backgroundColor: 'rgba(56, 189, 248, 0.2)', color: '#38bdf8' }}>Visited</span>}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            ))}
        </div>
    );
};

export default KanbanBoard;
