import { useState, useEffect } from 'react';

const PopupForm = ({ item, annotation, updateAnnotation, onDelete }) => {
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
        <div className="popup-content">
            <strong style={{ fontSize: '1.2em', display: 'block', marginBottom: '8px', borderBottom: '1px solid #ccc', paddingBottom: '4px' }}>
                {item.company}
            </strong>

            <div className="user-controls" style={{ marginBottom: '15px' }}>
                <div style={{ display: 'flex', gap: '4px', marginBottom: '8px', flexWrap: 'wrap' }}>
                    <button
                        onClick={() => updateAnnotation(item.id, 'status', 'good')}
                        style={{
                            background: annotation.status === 'good' ? '#22c55e' : '#f1f5f9',
                            color: annotation.status === 'good' ? 'white' : '#333',
                            border: '1px solid #cbd5e1', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', flex: 1, minWidth: '40px'
                        }}
                    >
                        Go
                    </button>
                    <button
                        onClick={() => updateAnnotation(item.id, 'status', 'maybe')}
                        style={{
                            background: annotation.status === 'maybe' ? '#f59e0b' : '#f1f5f9',
                            color: annotation.status === 'maybe' ? 'white' : '#333',
                            border: '1px solid #cbd5e1', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', flex: 1, minWidth: '40px'
                        }}
                    >
                        Maybe
                    </button>
                    <button
                        onClick={() => updateAnnotation(item.id, 'status', 'bad')}
                        style={{
                            background: annotation.status === 'bad' ? '#ef4444' : '#f1f5f9',
                            color: annotation.status === 'bad' ? 'white' : '#333',
                            border: '1px solid #cbd5e1', borderRadius: '4px', padding: '4px 8px', cursor: 'pointer', flex: 1, minWidth: '40px'
                        }}
                    >
                        No Go
                    </button>
                    <button
                        onClick={() => updateAnnotation(item.id, 'status', null)}
                        style={{ background: 'transparent', border: 'none', color: '#64748b', cursor: 'pointer', fontSize: '0.8em', padding: '0 5px' }}
                    >
                        ❌
                    </button>
                </div>

                <div style={{ textAlign: 'center', marginBottom: '8px' }}>
                    <button
                        onClick={onDelete}
                        style={{
                            background: 'transparent',
                            border: '1px solid #ef4444',
                            color: '#ef4444',
                            borderRadius: '4px',
                            padding: '4px 12px',
                            fontSize: '0.8em',
                            cursor: 'pointer'
                        }}
                    >
                        🗑️ DeleteLicense
                    </button>
                </div>

                <textarea
                    placeholder="Add your notes here..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    onBlur={(e) => handleBlur('comment', e.target.value)}
                    style={{ width: '100%', minHeight: '60px', padding: '6px', fontSize: '0.9em', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                />

                <div className="commercial-inputs" style={{ marginTop: '10px', display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px' }}>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.8rem', color: '#64748b' }}>Quantity (kg/tons)</label>
                            <input
                                type="number"
                                placeholder="0"
                                value={quantity}
                                onChange={(e) => setQuantity(e.target.value)}
                                onBlur={(e) => handleBlur('quantity', e.target.value)}
                                style={{ width: '100%', padding: '5px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label style={{ fontSize: '0.8rem', color: '#64748b' }}>Price ($)</label>
                            <input
                                type="number"
                                placeholder="0.00"
                                value={price}
                                onChange={(e) => setPrice(e.target.value)}
                                onBlur={(e) => handleBlur('price', e.target.value)}
                                style={{ width: '100%', padding: '5px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                        </div>
                    </div>

                    {(quantity && price) && (
                        <div style={{ background: '#ecfdf5', padding: '8px', borderRadius: '4px', color: '#047857', textAlign: 'center', fontWeight: 'bold' }}>
                            Total Value: ${(parseFloat(quantity) * parseFloat(price)).toLocaleString()}
                        </div>
                    )}
                </div>
            </div>

            <div style={{ fontSize: '0.9em', color: '#666', background: '#f8fafc', padding: '8px', borderRadius: '4px' }}>
                <div style={{ marginBottom: '2px' }}>
                    <span style={{ fontWeight: '600' }}>Status:</span>
                    <span style={{ color: item.status.toLowerCase().includes('active') ? 'green' : '#666', marginLeft: '4px' }}>
                        {item.status}
                    </span>
                </div>
                <div style={{ marginBottom: '2px' }}>
                    <span style={{ fontWeight: '600' }}>Type:</span>
                    <input
                        type="text"
                        value={licenseType}
                        onChange={(e) => setLicenseType(e.target.value)}
                        onBlur={(e) => handleBlur('licenseType', e.target.value)}
                        style={{
                            border: 'none',
                            borderBottom: '1px dashed #999',
                            background: 'transparent',
                            marginLeft: '4px',
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            width: '120px'
                        }}
                    />
                </div>
                <div style={{ marginBottom: '2px' }}>
                    <span style={{ fontWeight: '600' }}>Commodity:</span>
                    <input
                        type="text"
                        value={commodity}
                        onChange={(e) => setCommodity(e.target.value)}
                        onBlur={(e) => handleBlur('commodity', e.target.value)}
                        style={{
                            border: 'none',
                            borderBottom: '1px dashed #999',
                            background: 'transparent',
                            marginLeft: '4px',
                            fontFamily: 'inherit',
                            fontSize: 'inherit',
                            width: '120px'
                        }}
                    />
                </div>
                <div>
                    <span style={{ fontWeight: '600' }}>Region:</span> {item.region}
                </div>
                {item.date && <div>
                    <span style={{ fontWeight: '600' }}>Date:</span> {item.date}
                </div>}
                {item.contactPerson && <div style={{ marginTop: '8px', paddingTop: '8px', borderTop: '1px dashed #cbd5e1' }}>
                    <span style={{ fontWeight: '600', display: 'block', fontSize: '0.85em', color: '#475569' }}>Contact Person</span>
                    <span style={{ color: '#0f172a' }}>{item.contactPerson}</span>
                </div>}
                {item.phoneNumber && <div style={{ marginTop: '4px' }}>
                    <span style={{ fontWeight: '600', display: 'block', fontSize: '0.85em', color: '#475569' }}>Phone</span>
                    <a href={`tel:${item.phoneNumber}`} style={{ color: '#2563eb', textDecoration: 'none', fontWeight: 'bold' }}>{item.phoneNumber}</a>
                </div>}
            </div>
        </div>
    );
};

export default PopupForm;
