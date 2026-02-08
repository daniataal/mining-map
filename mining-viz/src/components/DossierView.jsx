import { useState, useEffect } from 'react';
import { useToast } from './Toast';

const DossierView = ({ item, annotation, updateAnnotation, onClose, isOpen }) => {
    const { addToast } = useToast();
    const [newNote, setNewNote] = useState('');
    const [uploading, setUploading] = useState(false);
    const [files, setFiles] = useState([]);

    // AI Report State
    const [aiReport, setAiReport] = useState(null);
    const [loadingAi, setLoadingAi] = useState(false);

    // Use window.location.hostname to ensure it works when accessing via IP (remote dev) 
    // instead of hardcoded localhost
    const API_BASE = import.meta.env.VITE_API_BASE ||
        (window.location.protocol === 'https:' ? '' : `http://${window.location.hostname}:8000`);

    const fetchFileList = () => {
        if (!item?.id) return;
        fetch(`${API_BASE}/licenses/${item.id}/files`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setFiles(data);
                else setFiles([]);
            })
            .catch(err => {
                console.error("Failed to load files", err);
                setFiles([]);
            });
    };

    const fetchAiReport = () => {
        setLoadingAi(true);
        setAiReport(null);

        const query = `Provide a due diligence summary for the mining company "${item.company}" located in ${item.region}, ${item.country}. They deal in "${item.commodity}". Check for any news, reputation, or license info.`;

        fetch(`${API_BASE}/api/ai/analyze`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ query: query })
        })
            .then(res => res.json())
            .then(data => {
                if (data.status === 'success') {
                    setAiReport(data.analysis);
                } else {
                    setAiReport("Could not generate report at this time. " + (data.message || ""));
                }
            })
            .catch(err => {
                setAiReport("Error connecting to AI service.");
                console.error(err);
            })
            .finally(() => setLoadingAi(false));
    };

    // Fetch files on mount/open - reset files first so we don't show prev item's files
    useEffect(() => {
        if (isOpen && item) {
            setFiles([]); // Clear previous state immediately
            setAiReport(null); // Clear previous AI report
            fetchFileList();
        }
    }, [isOpen, item]);

    if (!isOpen || !item) return null;

    const verification = annotation?.verification || {};
    const activityLog = annotation?.activityLog || [];

    const handleFileUpload = (e) => {
        const file = e.target.files[0];
        if (!file) return;

        setUploading(true);
        const formData = new FormData();
        formData.append('file', file);

        fetch(`${API_BASE}/licenses/${item.id}/files`, {
            method: 'POST',
            body: formData
        })
            .then(res => res.json())
            .then(newFile => {
                if (newFile.error) {
                    addToast(newFile.error, "error");
                } else {
                    setFiles(prev => [newFile, ...prev]);
                    addToast("File uploaded successfully", "success");
                }
            })
            .catch(err => addToast("Upload failed: " + err.message, "error"))
            .finally(() => {
                setUploading(false);
                e.target.value = null;
            });
    };

    const deleteFile = (fileId) => {
        if (!confirm("Are you sure?")) return;
        fetch(`${API_BASE}/files/${fileId}`, { method: 'DELETE' })
            .then(() => {
                setFiles(prev => prev.filter(f => f.id !== fileId));
                addToast("File deleted", "info");
            })
            .catch(err => addToast("Delete failed: " + err.message, "error"));
    };

    const toggleVerification = (key) => {
        const currentVal = verification[key] || false;
        updateAnnotation(item.id, 'verification', {
            ...verification,
            [key]: !currentVal
        });
    };

    const getFileIcon = (filename) => {
        if (!filename) return '📄';
        const ext = filename.split('.').pop().toLowerCase();
        if (['pdf'].includes(ext)) return '📕';
        if (['doc', 'docx'].includes(ext)) return '📘';
        if (['xls', 'xlsx', 'csv'].includes(ext)) return '📗';
        if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return '🖼️';
        return '📄';
    };

    const addNote = () => {
        if (!newNote.trim()) return;
        const note = {
            id: Date.now(),
            text: newNote,
            date: new Date().toISOString()
        };
        updateAnnotation(item.id, 'activityLog', [note, ...activityLog]);
        setNewNote('');
    };

    return (
        <div className={`dossier-panel ${isOpen ? 'open' : ''}`}>
            <div className="dossier-header">
                <h2>{item.company}</h2>
                <button className="close-btn" onClick={onClose}>×</button>
            </div>

            <div className="dossier-content">
                {/* Basic Info Section */}
                <section className="section">
                    <h3>License Details</h3>
                    <div className="grid-2">
                        <div>
                            <label>License Type</label>
                            <div>{annotation.licenseType || item.licenseType}</div>
                        </div>
                        <div>
                            <label>Commodity</label>
                            <div>{annotation.commodity || item.commodity}</div>
                        </div>
                        <div>
                            <label>Region</label>
                            <div>{item.region}</div>
                        </div>
                        <div>
                            <label>Contact</label>
                            <div>{item.contactPerson || '-'}</div>
                        </div>
                    </div>
                </section>

            </section>

            {/* AI Intelligence Section */}
            <section className="section" style={{ background: 'linear-gradient(to right, rgba(66, 133, 244, 0.05), rgba(168, 85, 247, 0.05))', border: '1px solid #e1e4e8' }}>
                <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px', color: '#6366f1' }}>
                    <span>🧠</span> AI Intelligence Report
                </h3>

                {!aiReport && !loadingAi && (
                    <>
                        <p style={{ fontSize: '0.9em', color: '#586069', marginBottom: '12px' }}>
                            Generate a real-time due diligence report on this entity using our AI engine.
                        </p>
                        <button
                            onClick={fetchAiReport}
                            disabled={loadingAi}
                            style={{
                                width: '100%',
                                padding: '12px',
                                background: 'linear-gradient(135deg, #6366f1, #8b5cf6)',
                                color: 'white',
                                border: 'none',
                                borderRadius: '8px',
                                fontWeight: '600',
                                fontSize: '0.95em',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: '8px',
                                boxShadow: '0 4px 6px rgba(99, 102, 241, 0.3)',
                                transition: 'all 0.2s'
                            }}
                        >
                            ✨ Generate Comprehensive Report
                        </button>
                    </>
                )}

                {loadingAi && (
                    <div style={{ textAlign: 'center', padding: '20px', color: '#6366f1' }}>
                        <div className="spinner" style={{
                            width: '24px', height: '24px', border: '3px solid rgba(99,102,241,0.3)',
                            borderTop: '3px solid #6366f1', borderRadius: '50%', margin: '0 auto 10px auto',
                            animation: 'spin 1s linear infinite'
                        }}></div>
                        <span style={{ fontSize: '0.9em', fontWeight: '500' }}>Analyzing global records...</span>
                        <style>{`@keyframes spin { 0% { transform: rotate(0deg); } 100% { transform: rotate(360deg); } }`}</style>
                    </div>
                )}

                {aiReport && (
                    <div className="ai-report-content" style={{
                        marginTop: '10px',
                        background: '#ffffff',
                        padding: '15px',
                        borderRadius: '8px',
                        border: '1px solid #e2e8f0',
                        fontSize: '0.9em',
                        lineHeight: '1.6',
                        color: '#1e293b',
                        whiteSpace: 'pre-wrap',
                        maxHeight: '300px',
                        overflowY: 'auto'
                    }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', borderBottom: '1px solid #f1f5f9', paddingBottom: '5px' }}>
                            <strong style={{ color: '#6366f1' }}>GENERATED ANALYSIS</strong>
                            <button onClick={() => setAiReport(null)} style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '0.8em' }}>Clear</button>
                        </div>
                        {aiReport}
                    </div>
                )}
            </section>

            {/* Verification Checklist (The "Trust Score") */}
            <section className="section">
                <h3>🛡️ Verification Checklist</h3>
                <div className="checklist">
                    <label>
                        <input
                            type="checkbox"
                            checked={verification.govMatch || false}
                            onChange={() => toggleVerification('govMatch')}
                        />
                        Official Gov Database Match
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={verification.taxClearance || false}
                            onChange={() => toggleVerification('taxClearance')}
                        />
                        Valid Tax Clearance Noted
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={verification.siteVisit || false}
                            onChange={() => toggleVerification('siteVisit')}
                        />
                        Physical Site Visit Confirmed
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            checked={verification.videoCall || false}
                            onChange={() => toggleVerification('videoCall')}
                        />
                        Video Call with Owner
                    </label>
                </div>
            </section>

            {/* CRM Pipeline Stage */}
            <section className="section">
                <h3>Pipeline Stage</h3>
                <div className="stage-selector">
                    <button className={annotation.stage === 'New' ? 'active' : ''} onClick={() => updateAnnotation(item.id, 'stage', 'New')}>New Lead</button>
                    <button className={annotation.stage === 'Contacted' ? 'active' : ''} onClick={() => updateAnnotation(item.id, 'stage', 'Contacted')}>Contacted</button>
                    <button className={annotation.stage === 'Diligence' ? 'active' : ''} onClick={() => updateAnnotation(item.id, 'stage', 'Diligence')}>Diligence</button>
                    <button className={annotation.stage === 'Verified' ? 'active' : ''} onClick={() => updateAnnotation(item.id, 'stage', 'Verified')}>Verified</button>
                    <button className={annotation.stage === 'Closed' ? 'active' : ''} onClick={() => updateAnnotation(item.id, 'stage', 'Closed')} style={{ borderColor: '#64748b' }}>Closed</button>
                </div>
            </section>

            {/* Marketplace Actions */}
            <section className="section" style={{ border: '1px solid #d97706', background: 'rgba(251, 191, 36, 0.05)' }}>
                <h3 style={{ color: '#d97706', borderBottomColor: '#d97706' }}>🚀 Marketplace Listing</h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                    <p style={{ fontSize: '0.85em', color: '#94a3b8', margin: 0 }}>
                        Publish this license to the public marketplace for investors to see.
                    </p>
                    <button
                        onClick={() => updateAnnotation(item.id, 'export_trigger', true)}
                        style={{
                            width: '100%',
                            padding: '10px',
                            background: 'linear-gradient(90deg, #d97706, #fbbf24)',
                            color: 'white',
                            border: 'none',
                            borderRadius: '6px',
                            fontWeight: 'bold',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            gap: '8px',
                            boxShadow: '0 4px 6px rgba(217, 119, 6, 0.2)'
                        }}
                    >
                        🌍 Export to Marketplace
                    </button>
                </div>
            </section>

            {/* File Management Section */}
            <section className="section">
                <h3>📂 Documents & Contracts</h3>
                <div className="file-upload-area">
                    <label className="upload-btn">
                        {uploading ? 'Uploading...' : '⬆️ Upload SPA / NCNDA'}
                        <input
                            type="file"
                            style={{ display: 'none' }}
                            onChange={handleFileUpload}
                            disabled={uploading}
                        />
                    </label>
                </div>

                <div className="file-list" style={{ marginTop: '15px' }}>
                    {files.length === 0 && <div style={{ color: '#94a3b8', fontSize: '0.85em', fontStyle: 'italic' }}>No documents uploaded.</div>}
                    {files.map(file => (
                        <div key={file.id} style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            background: '#f1f5f9',
                            padding: '8px',
                            borderRadius: '4px',
                            marginBottom: '5px',
                            fontSize: '0.9em'
                        }}>
                            <a
                                href={API_BASE.startsWith('http') ? encodeURI(`${API_BASE}${file.url}`) : encodeURI(`http://${API_BASE}${file.url}`)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ textDecoration: 'none', color: '#334155', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '5px' }}
                            >
                                {getFileIcon(file.filename)} {file.filename}
                            </a>
                            <button
                                onClick={() => deleteFile(file.id)}
                                style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '1.1em' }}
                                title="Delete File"
                            >
                                ×
                            </button>
                        </div>
                    ))}
                </div>
            </section>

            {/* Activity Log */}
            <section className="section">
                <h3>Activity Log</h3>
                <div className="log-input">
                    <textarea
                        placeholder="Log a call, email or meeting note..."
                        rows={3}
                        value={newNote}
                        onChange={(e) => setNewNote(e.target.value)}
                        style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    ></textarea>
                    <button className="log-btn" onClick={addNote}>Add Note</button>
                </div>

                <div className="log-history" style={{ marginTop: '15px' }}>
                    {activityLog.length === 0 && <div style={{ color: '#94a3b8', fontSize: '0.85em', fontStyle: 'italic' }}>No activity recorded yet.</div>}
                    {activityLog.map(note => (
                        <div key={note.id} style={{ borderLeft: '2px solid #cbd5e1', paddingLeft: '10px', marginBottom: '10px' }}>
                            <div style={{ fontSize: '0.75em', color: '#475569', fontWeight: '600' }}>{new Date(note.date).toLocaleString()}</div>
                            <div style={{ fontSize: '0.9em', color: '#0f172a', lineHeight: '1.4' }}>{note.text}</div>
                        </div>
                    ))}
                </div>
            </section>
        </div>
        </div >
    );
};

export default DossierView;
