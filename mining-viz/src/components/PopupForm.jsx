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
        <div className="popup-content" style={{ minWidth: '320px', maxHeight: '500px', overflowY: 'auto' }}>
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
                color: 'white',
                position: 'sticky',
                top: 0,
                zIndex: 10
            }}>
                <div style={{ flex: 1, paddingRight: '10px' }}>
                    <strong style={{ fontSize: '1.1em', display: 'block' }}>{item.company}</strong>
                    <span style={{ fontSize: '0.8em', opacity: 0.7 }}>{item.region}, {item.country}</span>
                </div>

                {/* Edit Toggle */}
                {!isEditing ? (
                    <button
                        onClick={() => setIsEditing(true)}
                        style={{
                            background: '#3b82f6', color: 'white', border: 'none', borderRadius: '6px',
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
                                background: '#22c55e', color: 'white', border: 'none', borderRadius: '6px',
                                padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8em'
                            }}
                        >
                            Apply
                        </button>
                        <button
                            onClick={handleCancel}
                            style={{
                                background: '#64748b', color: 'white', border: 'none', borderRadius: '6px',
                                padding: '6px 12px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.8em'
                            }}
                        >
                            ✕
                        </button>
                    </div>
                )}
            </div>

            {/* Quick Actions (Always Visible or maybe disabled when editing? Lets keep them accessible) */}
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

            {/* Editable Fields Container */}
            <div style={{ background: '#f8fafc', padding: '12px', borderRadius: '8px', border: '1px solid #e2e8f0', marginBottom: '15px', position: 'relative' }}>
                {/* Overlay to darken when not editing (optional, but requested "put it behind a protecting mechanism") */}
                {!isEditing && (
                    <div style={{
                        position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
                        backgroundColor: 'rgba(255,255,255,0)', // Transparent but blocks clicks? No, just render text.
                        // Actually, rendering text vs input is better. 
                        zIndex: 0
                    }} />
                )}

                {/* License Type */}
                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', fontSize: '0.7em', color: '#64748b', fontWeight: 'bold' }}>LICENSE TYPE</label>
                    {isEditing ? (
                        <input
                            list="license-types"
                            value={formData.licenseType}
                            onChange={(e) => setFormData({ ...formData, licenseType: e.target.value })}
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                    ) : (
                        <div style={{ fontSize: '0.95em', color: '#334155', fontWeight: '500' }}>{formData.licenseType || 'Unknown'}</div>
                    )}
                </div>

                {/* Commodity */}
                <div style={{ marginBottom: '10px' }}>
                    <label style={{ display: 'block', fontSize: '0.7em', color: '#64748b', fontWeight: 'bold' }}>COMMODITY</label>
                    {isEditing ? (
                        <input
                            list="commodities-list"
                            value={formData.commodity}
                            onChange={(e) => setFormData({ ...formData, commodity: e.target.value })}
                            style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                    ) : (
                        <div style={{ fontSize: '0.95em', color: '#334155', fontWeight: '500' }}>{formData.commodity || 'Unknown'}</div>
                    )}
                </div>

                <div style={{ display: 'flex', gap: '8px' }}>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.7em', color: '#64748b', fontWeight: 'bold' }}>QTY (KG)</label>
                        {isEditing ? (
                            <input
                                type="number"
                                value={formData.quantity}
                                onChange={(e) => setFormData({ ...formData, quantity: e.target.value })}
                                style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                        ) : (
                            <div style={{ fontSize: '0.95em', color: '#334155', fontWeight: '500' }}>{formData.quantity || '-'}</div>
                        )}
                    </div>
                    <div style={{ flex: 1 }}>
                        <label style={{ display: 'block', fontSize: '0.7em', color: '#64748b', fontWeight: 'bold' }}>PRICE ($)</label>
                        {isEditing ? (
                            <input
                                type="number"
                                value={formData.price}
                                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                                style={{ width: '100%', padding: '6px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                            />
                        ) : (
                            <div style={{ fontSize: '0.95em', color: '#334155', fontWeight: '500' }}>{formData.price || '-'}</div>
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
            <div style={{ background: '#f0f9ff', padding: '12px', borderRadius: '8px', border: '1px solid #bae6fd', marginBottom: '15px' }}>
                <div style={{ marginBottom: '8px', display: 'flex', alignItems: 'center', gap: '5px' }}>
                    <span style={{ fontSize: '1em' }}>📞</span>
                    <label style={{ fontSize: '0.75em', color: '#0369a1', fontWeight: 'bold' }}>CONTACT DETAILS</label>
                </div>

                <div style={{ marginBottom: '8px' }}>
                    <label style={{ display: 'block', fontSize: '0.7em', color: '#64748b', marginBottom: '2px' }}>Name / Position</label>
                    {isEditing ? (
                        <input
                            type="text"
                            placeholder="Contact Person..."
                            value={formData.contactPerson}
                            onChange={(e) => setFormData({ ...formData, contactPerson: e.target.value })}
                            style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                    ) : (
                        <div style={{ fontWeight: '500', color: '#334155' }}>{formData.contactPerson || 'No contact info'}</div>
                    )}
                </div>

                <div>
                    <label style={{ display: 'block', fontSize: '0.7em', color: '#64748b', marginBottom: '2px' }}>Phone Number</label>
                    {isEditing ? (
                        <input
                            type="tel"
                            placeholder="+233..."
                            value={formData.phoneNumber}
                            onChange={(e) => setFormData({ ...formData, phoneNumber: e.target.value })}
                            style={{ width: '100%', padding: '4px 8px', borderRadius: '4px', border: '1px solid #cbd5e1' }}
                        />
                    ) : (
                        <div style={{ fontWeight: '500', color: '#334155' }}>
                            {formData.phoneNumber ? (
                                <a href={`tel:${formData.phoneNumber}`} style={{ color: '#0284c7', textDecoration: 'none' }}>
                                    {formData.phoneNumber}
                                </a>
                            ) : (
                                <span style={{ color: '#94a3b8', fontStyle: 'italic' }}>No phone number</span>
                            )}
                        </div>
                    )}
                </div>
            </div>

            {/* Notes Section */}
            <div style={{ marginBottom: '15px' }}>
                <label style={{ display: 'block', fontSize: '0.75em', color: '#64748b', marginBottom: '4px', fontWeight: '600' }}>NOTES</label>
                {isEditing ? (
                    <textarea
                        placeholder="Add private notes..."
                        value={formData.comment}
                        onChange={(e) => setFormData({ ...formData, comment: e.target.value })}
                        style={{ width: '100%', minHeight: '60px', padding: '8px', fontSize: '0.9em', borderRadius: '6px', border: '1px solid #cbd5e1', resize: 'vertical' }}
                    />
                ) : (
                    <div style={{
                        background: '#f1f5f9', padding: '10px', borderRadius: '6px', minHeight: '40px', fontSize: '0.9em', color: formData.comment ? '#334155' : '#94a3b8', fontStyle: formData.comment ? 'normal' : 'italic'
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
                            border: '1px solid #fca5a5',
                            color: '#ef4444',
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
