import { useState, useEffect } from 'react';

const PopupForm = ({ item, annotation, updateAnnotation, onDelete, commodities, licenseTypes }) => {
    const [comment, setComment] = useState(annotation.comment || '');
    const [quantity, setQuantity] = useState(annotation.quantity || '');
    const [price, setPrice] = useState(annotation.price || '');
    const [licenseType, setLicenseType] = useState(annotation.licenseType || item.licenseType || '');
    const [commodity, setCommodity] = useState(annotation.commodity || item.commodity || '');

    // Update local state when prop changes (in case of external updates)
    useEffect(() => {
        setComment(annotation.comment || '');
        setQuantity(annotation.quantity || '');
        setPrice(annotation.price || '');
        setLicenseType(annotation.licenseType || item.licenseType || '');
        setCommodity(annotation.commodity || item.commodity || '');
    }, [annotation.comment, annotation.quantity, annotation.price, annotation.licenseType, item.licenseType, annotation.commodity, item.commodity]);

    const handleBlur = (field, value) => {
        if (value !== annotation[field]) {
            updateAnnotation(item.id, field, value);
        }
    };

    return (
        <div className="popup-content" style={{ minWidth: '300px' }}>
            {/* Header / Title */}
            <div style={{
                background: '#1e293b',
                margin: '-20px -24px 15px -24px', // Counteract Leaflet popup padding
                padding: '15px 20px',
                borderBottom: '1px solid #334155',
                borderTopLeftRadius: '12px',
                borderTopRightRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: 'white'
            }}>
                <div>
                    <strong style={{ fontSize: '1.1em', display: 'block' }}>{item.company}</strong>
                    <span style={{ fontSize: '0.8em', opacity: 0.7 }}>{item.region}, {item.country}</span>
                </div>
                <div style={{
                    fontSize: '0.75em',
                    padding: '2px 8px',
                    borderRadius: '12px',
                    background: item.status.toLowerCase().includes('active') ? 'rgba(34, 197, 94, 0.2)' : 'rgba(148, 163, 184, 0.2)',
                    color: item.status.toLowerCase().includes('active') ? '#4ade80' : '#94a3b8'
                }}>
                    {item.status}
                </div>
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '8px', marginBottom: '15px' }}>
                <button
                    onClick={() => updateAnnotation(item.id, 'status', 'good')}
                    title="Mark as Good"
                    style={{
                        background: annotation.status === 'good' ? '#22c55e' : '#f1f5f9',
                        color: annotation.status === 'good' ? 'white' : '#64748b',
                        border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px', cursor: 'pointer',
                        fontWeight: '600', fontSize: '0.9em'
                    }}
                >
                    ✅ Go
                </button>
                <button
                    onClick={() => updateAnnotation(item.id, 'status', 'maybe')}
                    title="Mark as Maybe"
                    style={{
                        background: annotation.status === 'maybe' ? '#f59e0b' : '#f1f5f9',
                        color: annotation.status === 'maybe' ? 'white' : '#64748b',
                        border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px', cursor: 'pointer',
                        fontWeight: '600', fontSize: '0.9em'
                    }}
                >
                    🤔 Maybe
                </button>
                <button
                    onClick={() => updateAnnotation(item.id, 'status', 'bad')}
                    title="Mark as No Go"
                    style={{
                        background: annotation.status === 'bad' ? '#ef4444' : '#f1f5f9',
                        color: annotation.status === 'bad' ? 'white' : '#64748b',
                        border: '1px solid #cbd5e1', borderRadius: '6px', padding: '6px', cursor: 'pointer',
                        fontWeight: '600', fontSize: '0.9em'
                    }}
                >
                    ❌ No
                </button>
                <button
                    onClick={() => updateAnnotation(item.id, 'status', null)}
                    title="Clear Status"
                    style={{ background: 'transparent', border: '1px solid #e2e8f0', borderRadius: '6px', color: '#94a3b8', cursor: 'pointer', width: '32px' }}
                >
                    🔄
                </button>
            </div>

            {/* Editable Fields */}
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '15px' }}>
                <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '0.75em', color: '#64748b', marginBottom: '2px', fontWeight: '600' }}>LICENSE TYPE (EDITABLE)</label>
                    <input
                        list="license-types"
                        value={licenseType}
                        onChange={(e) => setLicenseType(e.target.value)}
                        onBlur={(e) => handleBlur('licenseType', e.target.value)}
                        placeholder="Select or Type..."
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.9em' }}
                    />
                    <datalist id="license-types">
                        {licenseTypes && licenseTypes.filter(t => t !== 'All').map(t => <option key={t} value={t} />)}
                    </datalist>
                </div>
                <div>
                    <label style={{ display: 'block', fontSize: '0.75em', color: '#64748b', marginBottom: '2px', fontWeight: '600' }}>COMMODITY (EDITABLE)</label>
                    <input
                        list="commodities-list"
                        value={commodity}
                        onChange={(e) => setCommodity(e.target.value)}
                        onBlur={(e) => handleBlur('commodity', e.target.value)}
                        placeholder="Select or Type..."
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1', fontSize: '0.9em' }}
                    />
                    <datalist id="commodities-list">
                        {commodities && commodities.filter(t => t !== 'All').map(c => <option key={c} value={c} />)}
                    </datalist>
                </div>
            </div>

            {/* Notes Section */}
            <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontSize: '0.75em', color: '#64748b', marginBottom: '4px', fontWeight: '600' }}>NOTES</label>
                <textarea
                    placeholder="Add private notes..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onBlur={(e) => handleBlur('comment', e.target.value)}
                    style={{ width: '100%', minHeight: '60px', padding: '8px', fontSize: '0.9em', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'vertical' }}
                />
            </div>

            {/* Commercials */}
            <div style={{ display: 'flex', gap: '8px', marginBottom: '15px' }}>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.75em', color: '#64748b', fontWeight: '600' }}>QTY (KG)</label>
                    <input
                        type="number"
                        placeholder="0"
                        value={quantity}
                        onChange={(e) => setQuantity(e.target.value)}
                        onBlur={(e) => handleBlur('quantity', e.target.value)}
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                </div>
                <div style={{ flex: 1 }}>
                    <label style={{ fontSize: '0.75em', color: '#64748b', fontWeight: '600' }}>PRICE ($)</label>
                    <input
                        type="number"
                        placeholder="0.00"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        onBlur={(e) => handleBlur('price', e.target.value)}
                        style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                    />
                </div>
            </div>

            {(quantity && price) && (
                <div style={{ background: '#ecfdf5', padding: '10px', borderRadius: '6px', color: '#047857', textAlign: 'center', fontWeight: 'bold', border: '1px solid #a7f3d0' }}>
                    Est. Value: ${(parseFloat(quantity) * parseFloat(price)).toLocaleString()}
                </div>
            )}

            {/* Contact Info */}
            {(item.contactPerson || item.phoneNumber) && (
                <div style={{ marginTop: '15px', paddingTop: '10px', borderTop: '1px dashed #e2e8f0', fontSize: '0.85em' }}>
                    {item.contactPerson && <div style={{ color: '#334155', fontWeight: '600' }}>👤 {item.contactPerson}</div>}
                    {item.phoneNumber && (
                        <div style={{ marginTop: '4px' }}>
                            <a href={`tel:${item.phoneNumber}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '5px' }}>
                                📞 {item.phoneNumber}
                            </a>
                        </div>
                    )}
                </div>
            )}

            {/* Delete Button */}
            <div style={{ textAlign: 'center', marginTop: '15px' }}>
                <button
                    onClick={onDelete}
                    style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        fontSize: '0.8em',
                        cursor: 'pointer',
                        textDecoration: 'underline'
                    }}
                >
                    Delete License Permanently
                </button>
            </div>
        </div>
    );
};

export default PopupForm;
