import { useState, useEffect, useRef } from 'react';
import SkeletonLoader from './SkeletonLoader';

const Sidebar = ({
    processedData,
    filter, setFilter,
    sortBy, setSortBy,
    selectedCommodity, setSelectedCommodity,
    selectedCountry, setSelectedCountry,
    userStatusFilter, setUserStatusFilter,
    selectedLicenseType, setSelectedLicenseType,
    commodities, countries, licenseTypes,
    isAddModalOpen, setIsAddModalOpen,
    deleteFilteredList, loading,
    handleImport, handleTemplate, handleExport,
    selectedItem, setSelectedItem,
    hoveredItem, setHoveredItem,
    userAnnotations, rawData, error,
    onToggleCollapse, // New prop
    onLogout // New prop
}) => {

    // --- Sidebar Logic ---

    // Infinite scroll state
    const [displayCount, setDisplayCount] = useState(20);
    const observerTarget = useRef(null);

    // Reset display count when filters verify
    useEffect(() => {
        setDisplayCount(20);
    }, [processedData]);

    useEffect(() => {
        const observer = new IntersectionObserver(
            entries => {
                if (entries[0].isIntersecting && displayCount < processedData.length) {
                    setDisplayCount(prev => Math.min(prev + 20, processedData.length));
                }
            },
            { threshold: 0.1 }
        );

        if (observerTarget.current) {
            observer.observe(observerTarget.current);
        }

        return () => {
            if (observerTarget.current) {
                observer.unobserve(observerTarget.current);
            }
        };
    }, [displayCount, processedData.length]);

    return (
        <div className="sidebar">
            <div className="header" style={{ position: 'relative' }}>
                {onToggleCollapse && (
                    <button
                        onClick={onToggleCollapse}
                        style={{
                            position: 'absolute',
                            top: '20px',
                            right: '20px',
                            background: 'transparent',
                            border: '1px solid #475569',
                            color: '#94a3b8',
                            width: '30px',
                            height: '30px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '1.2rem',
                            zIndex: 10
                        }}
                        title="Minimize Sidebar"
                    >
                        «
                    </button>
                )}
                {onLogout && (
                    <button
                        onClick={onLogout}
                        style={{
                            position: 'absolute',
                            top: '20px',
                            right: onToggleCollapse ? '60px' : '20px',
                            background: 'transparent',
                            border: '1px solid #ef4444',
                            color: '#ef4444',
                            height: '30px',
                            padding: '0 10px',
                            borderRadius: '4px',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            fontSize: '0.9rem',
                            fontWeight: 'bold',
                            zIndex: 10
                        }}
                        title="Sign Out"
                    >
                        Sign Out
                    </button>
                )}
                <h1>Mining Licenses</h1>
                <p>Active licenses viewer</p>
                <button
                    onClick={() => setIsAddModalOpen(true)}
                    style={{
                        marginTop: '10px',
                        width: '100%',
                        padding: '8px',
                        backgroundColor: '#3b82f6',
                        color: 'white',
                        border: 'none',
                        borderRadius: '6px',
                        cursor: 'pointer',
                        fontWeight: 'bold'
                    }}
                >
                    + Add New License
                </button>

                <div className="action-buttons" style={{ display: 'flex', gap: '5px', marginTop: '10px' }}>
                    <label style={{ flex: 1, backgroundColor: '#475569', color: 'white', padding: '6px', borderRadius: '4px', textAlign: 'center', cursor: 'pointer', fontSize: '0.85em' }}>
                        📥 Import
                        <input type="file" accept=".csv" onChange={handleImport} style={{ display: 'none' }} />
                    </label>
                    <button onClick={handleTemplate} style={{ flex: 1, backgroundColor: 'transparent', border: '1px solid #475569', color: '#475569', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}>
                        📄 Template
                    </button>
                    <button onClick={handleExport} style={{ flex: 1, backgroundColor: 'transparent', border: '1px solid #3b82f6', color: '#3b82f6', padding: '6px', borderRadius: '4px', cursor: 'pointer', fontSize: '0.85em' }}>
                        📤 Export
                    </button>
                </div>
            </div>

            <div className="controls">
                <input
                    type="text"
                    placeholder="Search company or type..."
                    value={filter}
                    onChange={e => setFilter(e.target.value)}
                    className="search-input"
                />

                <div className="control-group">
                    <label>Sort by:</label>
                    <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                        <option value="company">Company</option>
                        <option value="status">Status</option>
                        <option value="commodity">Commodity</option>
                        <option value="date">Date</option>
                    </select>
                </div>

                <div className="control-group">
                    <label>Commodity:</label>
                    <select className="commodity-select" value={selectedCommodity} onChange={e => setSelectedCommodity(e.target.value)}>
                        {commodities.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                <div className="control-group">
                    <label>Country:</label>
                    <select value={selectedCountry} onChange={e => setSelectedCountry(e.target.value)}>
                        {countries.map(c => <option key={c} value={c}>{c}</option>)}
                    </select>
                </div>

                <div className="control-group">
                    <label>My Analysis:</label>
                    <select value={userStatusFilter} onChange={e => setUserStatusFilter(e.target.value)}>
                        <option value="All">All</option>
                        <option value="good">✅ Go</option>
                        <option value="maybe">🤔 Maybe</option>
                        <option value="bad">❌ No Go</option>
                        <option value="unmarked">Unmarked</option>
                    </select>
                </div>

                <div className="control-group">
                    <label>License Type:</label>
                    <select value={selectedLicenseType} onChange={e => setSelectedLicenseType(e.target.value)}>
                        {licenseTypes.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                </div>

                {(selectedCountry !== 'All' || selectedCommodity !== 'All' || filter || userStatusFilter !== 'All' || selectedLicenseType !== 'All') && (
                    <div style={{ marginTop: '15px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
                        <div style={{ fontSize: '0.85em', marginBottom: '5px', color: '#94a3b8' }}>
                            Showing {processedData.length} licenses
                        </div>
                        <button
                            onClick={deleteFilteredList}
                            style={{
                                width: '100%',
                                padding: '8px',
                                backgroundColor: '#ef4444',
                                color: 'white',
                                border: 'none',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '0.9em',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                            }}
                        >
                            🗑️ Delete ALL Visible ({processedData.length})
                        </button>
                    </div>
                )}
            </div>

            <div className="list-view">
                {processedData.slice(0, displayCount).map((item, idx) => {
                    const annotation = userAnnotations[item.id] || {};
                    const statusColor = annotation.status === 'good' ? '#22c55e' :
                        annotation.status === 'bad' ? '#ef4444' :
                            annotation.status === 'maybe' ? '#f59e0b' : 'transparent';
                    const isHovered = hoveredItem === item.id;
                    const isSelected = selectedItem?.id === item.id;

                    return (
                        <div
                            key={idx}
                            className={`mining-card ${selectedItem?.id === item.id ? 'active-card' : ''} ${annotation.commodity?.toLowerCase().includes('gold') || item.commodity?.toLowerCase().includes('gold') ? 'hologram' : ''}`}
                            onClick={() => setSelectedItem(item)}
                            onMouseEnter={() => setHoveredItem(item.id)}
                            onMouseLeave={() => setHoveredItem(null)}
                        >
                            <div className="card-header">
                                <h3 className="company-name">{item.company}</h3>
                                <div className="diamond-icon">
                                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M6 3h12l4 6-10 13L2 9z" />
                                    </svg>
                                </div>
                            </div>

                            <div className="card-badges">
                                <span className="status-capsule status-active">
                                    {item.status || 'Active'}
                                </span>
                                <span className={`commodity-capsule ${annotation.commodity?.toLowerCase().includes('gold') || item.commodity?.toLowerCase().includes('gold') ? 'commodity-gold' : ''}`}>
                                    {annotation.commodity || item.commodity || 'Unknown'}
                                </span>
                            </div>

                            <div className="card-location">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
                                    <circle cx="12" cy="10" r="3" />
                                </svg>
                                {item.region} | {annotation.licenseType || item.licenseType}
                            </div>

                            {item.phoneNumber && (
                                <div style={{ fontSize: '0.8rem', color: '#64748b', marginTop: '8px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                    <span>📞</span> <a href={`tel:${item.phoneNumber}`} onClick={(e) => e.stopPropagation()} style={{ color: '#2563eb', textDecoration: 'none' }}>{item.phoneNumber}</a>
                                </div>
                            )}

                            {annotation.status && <div style={{
                                marginTop: '10px',
                                borderTop: '1px solid rgba(255,255,255,0.1)',
                                paddingTop: '8px',
                                color: statusColor,
                                fontWeight: 'bold',
                                fontSize: '0.8rem',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px'
                            }}>
                                {annotation.status === 'good' ? '✅ GO' :
                                    annotation.status === 'bad' ? '❌ NO GO' :
                                        annotation.status === 'maybe' ? '🤔 MAYBE' : ''}
                                {annotation.comment && <span style={{ color: '#94a3b8', fontWeight: 'normal' }}>- {annotation.comment}</span>}
                            </div>}
                        </div>
                    );
                })}

                {displayCount < processedData.length && (
                    <div ref={observerTarget} className="scroll-loader">
                        <div className="loader-spinner"></div>
                        <div>Loading more...</div>
                    </div>
                )}

                {loading && <SkeletonLoader count={6} />}
                {error && <div className="error-message">{error}</div>}
                {!loading && !error && processedData.length === 0 && <div className="empty-state">No results found (Raw: {rawData.length})</div>}
            </div>
        </div>
    );
};

export default Sidebar;
