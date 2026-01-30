import { useState } from 'react';

const AddLicenseModal = ({ isOpen, onClose, onSubmit }) => {
    const [formData, setFormData] = useState({
        company: '',
        country: 'Ghana',
        region: '',
        commodity: '',
        licenseType: 'Large Scale',
        status: 'Operating',
        lat: '',
        lng: '',
        phoneNumber: '',
        contactPerson: ''
    });

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        onSubmit({
            ...formData,
            lat: parseFloat(formData.lat),
            lng: parseFloat(formData.lng)
        });
        onClose();
    };

    return (
        <div className="modal-overlay" style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'rgba(0,0,0,0.7)', zIndex: 9999,
            display: 'flex', justifyContent: 'center', alignItems: 'center'
        }}>
            <div className="modal-content" style={{
                backgroundColor: '#1e293b', padding: '20px', borderRadius: '8px',
                width: '500px', maxWidth: '90%', maxHeight: '90vh', overflowY: 'auto',
                color: '#f8fafc', border: '1px solid #334155'
            }}>
                <h2 style={{ marginTop: 0 }}>Add New License</h2>
                <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>

                    <label>Company Name *</label>
                    <input required type="text" value={formData.company} onChange={e => setFormData({ ...formData, company: e.target.value })} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label>Latitude *</label>
                            <input required type="number" step="any" value={formData.lat} onChange={e => setFormData({ ...formData, lat: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
                        </div>
                        <div style={{ flex: 1 }}>
                            <label>Longitude *</label>
                            <input required type="number" step="any" value={formData.lng} onChange={e => setFormData({ ...formData, lng: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
                        </div>
                    </div>

                    <label>Commodity</label>
                    <input type="text" value={formData.commodity} onChange={e => setFormData({ ...formData, commodity: e.target.value })} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />

                    <div style={{ display: 'flex', gap: '10px' }}>
                        <div style={{ flex: 1 }}>
                            <label>Country</label>
                            <select value={formData.country} onChange={e => setFormData({ ...formData, country: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}>
                                <option value="Ghana">Ghana</option>
                                <option value="South Africa">South Africa</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div style={{ flex: 1 }}>
                            <label>Region</label>
                            <input type="text" value={formData.region} onChange={e => setFormData({ ...formData, region: e.target.value })} style={{ width: '100%', padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />
                        </div>
                    </div>

                    <label>Status</label>
                    <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value })} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }}>
                        <option value="Operating">Operating</option>
                        <option value="Closed">Closed</option>
                        <option value="Maintenance">Maintenance</option>
                    </select>

                    <label>Phone</label>
                    <input type="text" value={formData.phoneNumber} onChange={e => setFormData({ ...formData, phoneNumber: e.target.value })} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />

                    <label>Contact Person</label>
                    <input type="text" value={formData.contactPerson} onChange={e => setFormData({ ...formData, contactPerson: e.target.value })} style={{ padding: '8px', borderRadius: '4px', border: '1px solid #475569', background: '#0f172a', color: 'white' }} />

                    <div style={{ display: 'flex', gap: '10px', marginTop: '10px' }}>
                        <button type="button" onClick={onClose} style={{ flex: 1, padding: '10px', backgroundColor: '#64748b', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer' }}>Cancel</button>
                        <button type="submit" style={{ flex: 1, padding: '10px', backgroundColor: '#22c55e', border: 'none', borderRadius: '4px', color: 'white', cursor: 'pointer', fontWeight: 'bold' }}>Create</button>
                    </div>
                </form>
            </div>
        </div>
    );
};

export default AddLicenseModal;
