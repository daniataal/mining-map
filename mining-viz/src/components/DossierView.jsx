import { useState, useEffect } from 'react';

const DossierView = ({ item, annotation, updateAnnotation, onClose, isOpen }) => {
    const [newNote, setNewNote] = useState('');

    if (!isOpen || !item) return null;

    const verification = annotation.verification || {};
    const activityLog = annotation.activityLog || [];
    const [uploading, setUploading] = useState(false);
    const [files, setFiles] = useState([]);

    // Fetch files on mount/open
    useEffect(() => {
        if (isOpen && item) {
            fetchFileList();
        }
    }, [isOpen, item]);

    const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

    const fetchFileList = () => {
        fetch(`${API_BASE}/licenses/${item.id}/files`)
            .then(res => res.json())
            .then(data => {
                if (Array.isArray(data)) setFiles(data);
            })
            .catch(err => console.error("Failed to load files", err));
    };

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
                    alert(newFile.error);
                } else {
                    setFiles(prev => [newFile, ...prev]);
                }
            })
            .catch(err => alert("Upload failed: " + err.message))
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
            })
            .catch(err => alert("Delete failed: " + err.message));
    };

    const toggleVerification = (key) => {
        const currentVal = verification[key] || false;
        updateAnnotation(item.id, 'verification', {
            ...verification,
            [key]: !currentVal
        });
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
                                <a href={`${API_BASE}${file.url}`} target="_blank" rel="noopener noreferrer" style={{ textDecoration: 'none', color: '#334155', fontWeight: '500', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                    📄 {file.filename}
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
        </div>
    );
};

export default DossierView;
