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
        <div className={`kanban-board ${isMobile ? 'mobile' : ''}`}>

            {/* Mobile Tab Selector */}
            {isMobile && (
                <div className="kanban-stage-tabs">
                    {stages.map(stage => {
                        const isActive = activeStage === stage;
                        const color = getStageColor(stage);
                        return (
                            <button
                                key={stage}
                                onClick={() => setActiveStage(stage)}
                                className={`kanban-stage-tab ${isActive ? 'active' : ''}`}
                                style={{ '--stage-color': color }}
                            >
                                {stage} ({columns[stage].length})
                            </button>
                        );
                    })}
                </div>
            )}

            {/* Content Container */}
            <div className={`kanban-columns ${isMobile ? 'mobile' : ''}`}>
                {stagesToRender.map(stage => (
                    <div key={stage} className={`kanban-column ${isMobile ? 'mobile' : ''}`}>
                        {/* Column Header */}
                        <div className="kanban-column-header" style={{ '--stage-color': getStageColor(stage) }}>
                            <h3>{stage}</h3>
                            <span className="kanban-count-pill">
                                {columns[stage].length}
                            </span>
                        </div>

                        {/* Cards - This is the scrollable part */}
                        <div className="kanban-card-list">
                            {columns[stage].map(item => {
                                const annotation = userAnnotations[item.id] || {};
                                return (
                                    <div
                                        key={item.id}
                                        onClick={() => onCardClick(item)}
                                        className="mining-card"
                                        style={{ margin: 0 }}
                                        onMouseOver={(e) => !isMobile && (e.currentTarget.style.transform = 'translateY(-2px)')}
                                        onMouseOut={(e) => !isMobile && (e.currentTarget.style.transform = 'none')}
                                    >
                                        <div className="kanban-card-title">{item.company}</div>
                                        <div className="kanban-card-subtitle">{annotation.commodity || item.commodity}</div>

                                        {/* Simple separator */}
                                        <div className="kanban-separator"></div>

                                        {/* Mini Tags */}
                                        <div className="kanban-tags">
                                            {annotation.status === 'good' && <span className="kanban-tag go">GO</span>}
                                            {annotation.verification?.siteVisit && <span className="kanban-tag visited">Visited</span>}
                                        </div>
                                    </div>
                                );
                            })}
                            {columns[stage].length === 0 && <div className="kanban-empty">No items in this stage</div>}
                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default KanbanBoard;
