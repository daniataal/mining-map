import { useState, useEffect } from 'react';

const PopupForm = ({ item, annotation, updateAnnotation, onDelete, commodities, licenseTypes, isMobile, onOpenDossier }) => {
    const [isEditing, setIsEditing] = useState(false);

    // Local state for form fields - initialized from props
    const [formData, setFormData] = useState({
        comment: '',
        quantity: '',
        price: '',
        licenseType: '',
        commodity: '',
        phoneNumber: '',
        contactPerson: ''
    });

    // Sync state with props when not editing (or on open)
    useEffect(() => {
        if (!isEditing) {
            setFormData({
                comment: annotation.comment || '',
                quantity: annotation.quantity || '',
                price: annotation.price || '',
                licenseType: annotation.licenseType || item.licenseType || '',
                commodity: annotation.commodity || item.commodity || '',
                phoneNumber: annotation.phoneNumber || item.phoneNumber || '',
                contactPerson: annotation.contactPerson || item.contactPerson || ''
            });
        }
    }, [isEditing, annotation, item]);

    const handleSave = () => {
        // Prepare updates
        const updates = {};

        // Helper to check if changed
        const hasChanged = (field, originalValue) => {
            const val = formData[field];
            // Simple strict equality might be enough if types match
            return val != (originalValue || ''); // loosen comparison slightly for null/undefined vs empty string
        };

        updates.comment = formData.comment;
        updates.quantity = formData.quantity;
        updates.price = formData.price;
        updates.licenseType = formData.licenseType;
        updates.commodity = formData.commodity;
        updates.phoneNumber = formData.phoneNumber;
        updates.contactPerson = formData.contactPerson;

        // We could optimize by only sending changed fields, 
        // but App.jsx updateAnnotation handles merging, so sending all form data is safer to ensure sync.
        // Actually, passing everything overrides everything. 

        updateAnnotation(item.id, updates);
        setIsEditing(false);
    };

    const handleCancel = () => {
        setIsEditing(false);
        // Effect will reset data
    };

    return (
        <div className="popup-content" style={{ minWidth: '320px', maxHeight: '500px', overflowY: 'auto', backgroundColor: '#0d1117' }}>
            {/* Header / Title */}
            <div style={{
                background: '#161b22',
                margin: '-20px -24px 15px -24px', // Counteract Leaflet popup padding
                padding: '15px 20px',
                borderBottom: '1px solid #30363d',
                borderTopLeftRadius: '12px',
                borderTopRightRadius: '12px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                color: '#e6edf3',
                position: 'sticky',
                top: 0,
                zIndex: 10
            }}>
                <div style={{ flex: 1, paddingRight: '10px' }}>
                    <strong style={{ fontSize: '1.1em', display: 'block' }}>{item.company}</strong>
                    <span style={{ fontSize: '0.8em', color: '#8b949e' }}>{item.region}, {item.country}</span>
                </div>

                {/* Edit Toggle */}
                {!isEditing ? (
                    <button
                        onClick={() => setIsEditing(true)}
                        style={{
                            background: '#fbbf24', color: '#0d1117', border: 'none', borderRadius: '6px',
                            padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8em'
                        }}
                    >
                        ✏️ Edit
                    </button>
                ) : (
                    <div style={{ display: 'flex', gap: '5px' }}>
                        <button
                            onClick={handleSave}
                            style={{
                                background: '#238636', color: 'white', border: 'none', borderRadius: '6px',
                                padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8em'
                            }}
                        >
                            Apply
                        </button>
                        <button
                            onClick={handleCancel}
                            style={{
                                background: '#30363d', color: '#e6edf3', border: 'none', borderRadius: '6px',
                                padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8em'
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}
            </div>

            {/* Quick Actions */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr auto', gap: '8px', marginBottom: '15px' }}>
                <button
                    onClick={() => updateAnnotation(item.id, 'status', 'good')}
                    title="Mark as Good"
                    style={{
                        background: annotation.status === 'good' ? 'rgba(46, 160, 67, 0.2)' : '#21262d',
                        color: annotation.status === 'good' ? '#3fb950' : '#8b949e',
                        border: annotation.status === 'good' ? '1px solid #3fb950' : '1px solid #30363d',
                        borderRadius: '6px', padding: '6px', cursor: 'pointer',
                        fontWeight: '600', fontSize: '0.9em'
                    }}
                >
                    ✅ Go
                </button>
                <button
                    onClick={() => updateAnnotation(item.id, 'status', 'maybe')}
                    title="Mark as Maybe"
                    style={{
                        background: annotation.status === 'maybe' ? 'rgba(210, 153, 34, 0.2)' : '#21262d',
                        color: annotation.status === 'maybe' ? '#d29922' : '#8b949e',
                        border: annotation.status === 'maybe' ? '1px solid #d29922' : '1px solid #30363d',
                        borderRadius: '6px', padding: '6px', cursor: 'pointer',
                        fontWeight: '600', fontSize: '0.9em'
                    }}
                >
                    🤔 Maybe
                </button>
                <button
                    onClick={() => updateAnnotation(item.id, 'status', 'bad')}
                    title="Mark as No Go"
                    style={{
                        background: annotation.status === 'bad' ? 'rgba(248, 81, 73, 0.2)' : '#21262d',
                        color: annotation.status === 'bad' ? '#f85149' : '#8b949e',
                        border: annotation.status === 'bad' ? '1px solid #f85149' : '1px solid #30363d',
                        borderRadius: '6px', padding: '6px', cursor: 'pointer',
                        fontWeight: '600', fontSize: '0.9em'
                    }}
                >
                    ❌ No
                </button>
                <button
                    onClick={() => updateAnnotation(item.id, 'status', null)}
                    title="Clear Status"
                    style={{ background: 'transparent', border: '1px solid #30363d', borderRadius: '6px', color: '#8b949e', cursor: 'pointer', width: '32px' }}
                >
                    🔄
                </button>
            </div>

            {/* Editable Fields Container */}
            <div style={{ background: '#161b22', padding: '12px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '15px', position: 'relative' }}>
                {!isEditing && (
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        zIndex: 0
                    }} />
                )}

                {/* License Type */}
                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', fontSize: '0.7em', color: '#8b949e', fontWeight: 'bold' }}>LICENSE TYPE</label>
                    {isEditing ? (
                        <input
                            list="license-types"
                            value={formData.licenseType}
                            onChange={(e) => setFormData({ ...formData, licenseType: e.target.value })}
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #30363d', background: '#0d1117', color: '#e6edf3' }}
                        />
                    ) : (
                        <div style={{ fontSize: '0.95em', color: '#e6edf3', fontWeight: '500' }}>{formData.licenseType || 'Unknown'}</div>
                    )}
                </div>

                {/* Commodity */}
                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', fontSize: '0.7em', color: '#8b949e', fontWeight: 'bold' }}>COMMODITY</label>
                    {isEditing ? (
                        <input
                            list="commodities-list"
                            value={formData.commodity}
                            onChange={(e) => setFormData({ ...formData, commodity: e.target.value })}
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #30363d', background: '#0d1117', color: '#e6edf3' }}
                        />
                    ) : (
                        <div style={{ fontSize: '0.95em', color: '#e6edf3', fontWeight: '500' }}>{formData.commodity || 'Unknown'}</div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.7em', color: '#8b949e', fontWeight: 'bold' }}>QTY (KG)</label>
                        {isEditing ? (
                            <input
                                type="number"
                                value={formData.quantity}
                                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #30363d', background: '#0d1117', color: '#e6edf3' }}
                            />
                        ) : (
                            <div style={{ fontSize: '0.95em', color: '#e6edf3', fontWeight: '500' }}>{formData.quantity || '-'}</div>
                        )}
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.7em', color: '#8b949e', fontWeight: 'bold' }}>PRICE ($)</label>
                        {isEditing ? (
                            <input
                                type="number"
                                value={formData.price}
                                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #30363d', background: '#0d1117', color: '#e6edf3' }}
                            />
                        ) : (
                            <div style={{ fontSize: '0.95em', color: '#e6edf3', fontWeight: '500' }}>{formData.price || '-'}</div>
                        )}
                    </div>
                </div>

                {/* Datalists */}
                <datalist id="license-types">
                    {licenseTypes && licenseTypes.filter(t => t !== 'All').map(t => <option key={t} value={t} />)}
                </datalist>
                <datalist id="commodities-list">
                    {commodities && commodities.filter(t => t !== 'All').map(c => <option key={c} value={c} />)}
                </datalist>
            </div>

            {/* Contact Info Section */}
            <div style={{ background: '#1e232d', padding: '12px', borderRadius: '8px', border: '1px solid #30363d', marginBottom: '15px' }}>
                <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '1em' }}>📞</span>
                    <label style={{ fontSize: '0.75em', color: '#58a6ff', fontWeight: 'bold' }}>CONTACT DETAILS</label>
                </div>

                <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '0.7em', color: '#8b949e', marginBottom: '2px' }}>Name / Position</label>
                    {isEditing ? (
                        <input
                            type="text"
                            placeholder="Contact Person..."
                            value={formData.contactPerson}
                            onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                            style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid #30363d', background: '#0d1117', color: '#e6edf3' }}
                        />
                    ) : (
                        <div style={{ fontWeight: '500', color: '#e6edf3' }}>{formData.contactPerson || 'No contact info'}</div>
                    )}
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '0.7em', color: '#8b949e', marginBottom: '2px' }}>Phone Number</label>
                    {isEditing ? (
                        <input
                            type="tel"
                            placeholder="+233..."
                            value={formData.phoneNumber}
                            onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                            style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid #30363d', background: '#0d1117', color: '#e6edf3' }}
                        />
                    ) : (
                        <div style={{ fontWeight: '500', color: '#e6edf3' }}>
                            {formData.phoneNumber ? (
                                <a href={`tel:${formData.phoneNumber}`} style={{ color: '#58a6ff', textDecoration: 'none' }}>
                                    {formData.phoneNumber}
                                </a>
                            ) : (
                                <span style={{ color: '#8b949e', fontStyle: 'italic' }}>No phone number</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Notes Section */}
            <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontSize: '0.75em', color: '#8b949e', marginBottom: '4px', fontWeight: '600' }}>NOTES</label>
                {isEditing ? (
                    <textarea
                        placeholder="Add private notes..."
                        value={formData.comment}
                        onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                        style={{ width: '100%', minHeight: '60px', padding: '8px', fontSize: '0.9em', borderRadius: '6px', border: '1px solid #30363d', resize: 'vertical', background: '#0d1117', color: '#e6edf3' }}
                    />
                ) : (
                    <div style={{
                        background: '#161b22', padding: '10px', borderRadius: '6px', minHeight: '40px', fontSize: '0.9em', color: formData.comment ? '#e6edf3' : '#8b949e', fontStyle: formData.comment ? 'normal' : 'italic'
                    }}>
                        {formData.comment || 'No notes added.'}
                    </div>
                )}
            </div>

            {/* Delete Button */}
            {isEditing && (
                <div style={{ textAlign: 'center', marginTop: '15px' }}>
                    <button
                        onClick={onDelete}
                        style={{
                            background: 'transparent',
                            border: '1px solid #f85149',
                            color: '#f85149',
                            fontSize: '0.8em',
                            cursor: 'pointer',
                            padding: '6px 12px',
                            borderRadius: '4px'
                        }}
                    >
                        🗑️ Delete License
                    </button>
                </div>
            )}
        </div>
    );
};

export default PopupForm;
