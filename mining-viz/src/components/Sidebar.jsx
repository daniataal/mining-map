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

    const [showFilters, setShowFilters] = useState(false);

    // Reset display count when filters verify
    useEffect(() => {
        setDisplayCount(20);
    }, [processedData]);

    // ... (rest of observers)

    return (
        <div className="sidebar">
            <div className="header">
                {/* ... (Header content doesn't change) */}
                <div className="sidebar-header-top">
                    <div>
                        <h1 className="sidebar-title">Mining Licenses</h1>
                        <p className="sidebar-subtitle">Active licenses viewer</p>
                    </div>
                    {/* ... (Actions) */}
                    <div className="header-actions">
                        {onLogout && (
                            <button onClick={onLogout} className="icon-btn danger" title="Sign Out">
                                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"></path><polyline points="16 17 21 12 16 7"></polyline><line x1="21" y1="12" x2="9" y2="12"></line></svg>
                            </button>
                        )}
                        {onToggleCollapse && (
                            <button onClick={onToggleCollapse} className="icon-btn" title="Minimize Sidebar">«</button>
                        )}
                    </div>
                </div>

                <button onClick={() => setIsAddModalOpen(true)} className="primary-btn-full">+ Add New License</button>

                <div className="action-row">
                    <label className="secondary-btn file-input-label">
                        <input type="file" accept=".csv" onChange={handleImport} style={{ display: 'none' }} />
                        <span>📥 Import</span>
                    </label>
                    <button onClick={handleTemplate} className="secondary-btn"><span>📄 Template</span></button>
                    <button onClick={handleExport} className="secondary-btn"><span>📤 Export</span></button>
                </div>
            </div>

            <div className="controls">
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <input
                        type="text"
                        placeholder="Search..."
                        value={filter}
                        onChange={e => setFilter(e.target.value)}
                        className="search-input"
                        style={{ margin: 0, flex: 1 }}
                    />
                    <button
                        onClick={() => setShowFilters(!showFilters)}
                        className="secondary-btn"
                        style={{ padding: '0 12px' }}
                    >
                        {showFilters ? 'Hide' : 'Filters'}
                    </button>
                </div>

                {showFilters && (
                    <div className="filters-grid">
                        <div className="control-group">
                            <label>Sort by</label>
                            <select value={sortBy} onChange={e => setSortBy(e.target.value)}>
                                <option value="company">Company</option>
                                <option value="status">Status</option>
                                <option value="commodity">Commodity</option>
                                <option value="date">Date</option>
                            </select>
                        </div>

                        <div className="control-group">
                            <label>Commodity</label>
                            <select className="commodity-select" value={selectedCommodity} onChange={e => setSelectedCommodity(e.target.value)}>
                                {commodities.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>

                        <div className="control-group">
                            <label>Country</label>
                            <select value={selectedCountry} onChange={e => setSelectedCountry(e.target.value)}>
                                {countries.map(c => <option key={c} value={c}>{c}</option>)}
                            </select>
                        </div>

                        <div className="control-group">
                            <label>My Analysis</label>
                            <select value={userStatusFilter} onChange={e => setUserStatusFilter(e.target.value)}>
                                <option value="All">All</option>
                                <option value="good">✅ Go</option>
                                <option value="maybe">🤔 Maybe</option>
                                <option value="bad">❌ No Go</option>
                                <option value="unmarked">Unmarked</option>
                            </select>
                        </div>

                        <div className="control-group">
                            <label>License Type</label>
                            <select value={selectedLicenseType} onChange={e => setSelectedLicenseType(e.target.value)}>
                                {licenseTypes.map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                        </div>
                    </div>
                )}

                {showFilters && (selectedCountry !== 'All' || selectedCommodity !== 'All' || filter || userStatusFilter !== 'All' || selectedLicenseType !== 'All') && (
                    <div style={{ marginTop: '15px', borderTop: '1px solid #334155', paddingTop: '10px' }}>
                        <div style={{ fontSize: '0.85em', marginBottom: '8px', color: '#94a3b8', textAlign: 'center' }}>
                            Found {processedData.length} matches
                        </div>
                        <button
                            onClick={deleteFilteredList}
                            style={{
                                width: '100%',
                                padding: '8px',
                                backgroundColor: 'rgba(239, 68, 68, 0.15)',
                                color: '#f85149',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                borderRadius: '6px',
                                cursor: 'pointer',
                                fontWeight: 'bold',
                                fontSize: '0.85rem',
                                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px'
                            }}
                        >
                            🗑️ Delete Visible ({processedData.length})
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
