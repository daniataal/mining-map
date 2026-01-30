import { useState, useMemo, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMap, LayersControl } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import './App.css';
import L from 'leaflet';

// Fix for default marker icon in React Leaflet
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
import MarkerClusterGroup from 'react-leaflet-cluster';

let DefaultIcon = L.icon({
  iconUrl: icon,
  shadowUrl: iconShadow,
  iconSize: [25, 41],
  iconAnchor: [12, 41]
});

L.Marker.prototype.options.icon = DefaultIcon;

// Custom Icons
const createCustomIcon = (color, isHovered) => {
  const size = isHovered ? 24 : 12;
  const border = isHovered ? '3px solid white' : '2px solid white';
  const boxShadow = isHovered ? '0 0 10px rgba(0,0,0,0.8)' : '0 0 4px rgba(0,0,0,0.5)';

  return new L.DivIcon({
    className: 'custom-marker',
    html: `<div style="background-color: ${color}; width: ${size}px; height: ${size}px; border-radius: 50%; border: ${border}; box-shadow: ${boxShadow}; transition: all 0.2s ease;"></div>`,
    iconSize: isHovered ? [28, 28] : [16, 16],
    iconAnchor: isHovered ? [14, 14] : [8, 8],
    popupAnchor: [0, -8]
  });
};

const getMarkerColor = (commodity, userStatus) => {
  // User override
  if (userStatus === 'good') return '#22c55e'; // Green-500
  if (userStatus === 'bad') return '#ef4444'; // Red-500
  if (userStatus === 'maybe') return '#f59e0b'; // Amber-500 (Orange)

  if (!commodity) return '#94a3b8';
  const c = commodity.toLowerCase();
  if (c.includes('gold')) return '#fbbf24'; // Amber-400
  if (c.includes('diamond')) return '#60a5fa'; // Blue-400
  if (c.includes('bauxite')) return '#f87171'; // Red-400
  if (c.includes('manganese')) return '#a78bfa'; // Purple-400
  if (c.includes('lithium')) return '#34d399'; // Emerald-400
  if (c.includes('iron')) return '#ef4444'; // Red-500
  if (c.includes('salt')) return '#fcd34d'; // Amber-300
  return '#94a3b8'; // Slate-400
};

// Component to handle map flyTo effects
const MapEffect = ({ selectedItem }) => {
  const map = useMap();
  useEffect(() => {
    if (selectedItem && selectedItem.lat && selectedItem.lng) {
      map.flyTo([selectedItem.lat, selectedItem.lng], 25, {
        duration: 2.0
      });
    }
  }, [selectedItem, map]);
  return null;
};

// Sample data placeholder (will be replaced by real data)
// Popup Form Component to handle local state and avoid re-renders on typing
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
  );
};


// Add License Modal Component
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


function App() {
  const [rawData, setRawData] = useState([]);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState('company');
  const [selectedCountry, setSelectedCountry] = useState('All');
  const [selectedCommodity, setSelectedCommodity] = useState('All');
  const [selectedLicenseType, setSelectedLicenseType] = useState('All');
  const [userStatusFilter, setUserStatusFilter] = useState('All');
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);

  // Interaction states
  const [selectedItem, setSelectedItem] = useState(null);
  const [hoveredItem, setHoveredItem] = useState(null);

  // Load annotations from local storage
  const [userAnnotations, setUserAnnotations] = useState(() => {
    try {
      const saved = localStorage.getItem('mining_user_data');
      return saved ? JSON.parse(saved) : {};
    } catch (e) {
      console.error("Failed to load user data", e);
      return {};
    }
  });

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Get API base URL from env
  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

  const deleteLicense = (id) => {
    if (!confirm("Are you sure you want to delete this license?")) return;

    fetch(`${API_BASE}/licenses/${id}`, { method: 'DELETE' })
      .then(res => {
        if (!res.ok) throw new Error("Failed to delete");
        setRawData(prev => prev.filter(item => item.id !== id));
        setSelectedItem(null);
      })
      .catch(err => alert("Error deleting license: " + err.message));
  };

  const deleteFilteredList = () => {
    const idsToDelete = processedData.map(item => item.id);
    if (idsToDelete.length === 0) return;

    if (!confirm(`WARNING: You are about to DELETE ALL ${idsToDelete.length} licenses currently in the list view.\n\nType: ${selectedLicenseType}\nCountry: ${selectedCountry}\nCommodity: ${selectedCommodity}\n\nThis action cannot be undone. Are you sure?`)) {
      return;
    }

    setLoading(true);
    fetch(`${API_BASE}/licenses/batch-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: idsToDelete })
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to delete batch");
        return res.json();
      })
      .then(data => {
        alert(`Successfully deleted ${data.deleted_count} licenses.`);
        // Refresh data or remove from local state
        setRawData(prev => prev.filter(item => !idsToDelete.includes(item.id)));
        setSelectedItem(null);
      })
      .catch(err => alert("Error batch deleting: " + err.message))
      .finally(() => setLoading(false));
  };


  const handleCreateLicense = (newItem) => {
    fetch(`${API_BASE}/licenses`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(newItem)
    })
      .then(res => {
        if (!res.ok) throw new Error("Failed to create");
        return res.json();
      })
      .then(data => {
        setRawData(prev => [...prev, data]);
        setSelectedItem(data); // Auto select the new item
        alert("License created successfully!");
      })
      .catch(err => alert("Error creating license: " + err.message));
  };

  const handleExport = () => {
    window.location.href = `${API_BASE}/licenses/export`;
  };

  const handleTemplate = () => {
    window.location.href = `${API_BASE}/licenses/template`;
  };

  const handleImport = (event) => {
    const file = event.target.files[0];
    if (!file) return;

    const formData = new FormData();
    formData.append('file', file);

    setLoading(true);
    fetch(`${API_BASE}/licenses/import`, {
      method: 'POST',
      body: formData
    })
      .then(res => res.json())
      .then(data => {
        if (data.status === 'success') {
          alert(`Successfully imported ${data.imported_count} licenses.`);
          window.location.reload(); // Simple reload to fetch new data
        } else {
          alert("Import failed: " + data.message);
        }
      })
      .catch(err => alert("Error importing: " + err.message))
      .finally(() => {
        setLoading(false);
        event.target.value = null; // Reset input
      });
  };

  // Fetch data from backend
  useEffect(() => {
    setLoading(true);
    fetch(`${API_BASE}/licenses`)
      .then(res => {
        if (!res.ok) {
          throw new Error(`HTTP error! status: ${res.status}`);
        }
        return res.json();
      })
      .then(data => {
        if (Array.isArray(data)) {
          console.log(`Loaded ${data.length} licenses`);
          setRawData(data);
          setError(null);
        } else {
          console.error("Received invalid data format:", data);
          setError('Invalid data format received');
        }
      })
      .catch(err => {
        console.error("Failed to fetch licenses:", err);
        setError(`Failed to fetch data: ${err.message}. Is backend running?`);
      })
      .finally(() => setLoading(false));
  }, []);

  const updateAnnotation = (id, field, value) => {
    setUserAnnotations(prev => {
      const next = {
        ...prev,
        [id]: {
          ...prev[id],
          [field]: value
        }
      };
      localStorage.setItem('mining_user_data', JSON.stringify(next));
      return next;
    });
  };

  // Extract unique countries
  const countries = useMemo(() => {
    const c = new Set(rawData.map(item => item.country || 'Ghana')); // Default to Ghana if missing
    return ['All', ...Array.from(c)];
  }, [rawData]);

  // Extract unique commodities
  const commodities = useMemo(() => {
    const c = new Set(rawData.map(item => {
      const annotation = userAnnotations[item.id] || {};
      return annotation.commodity || item.commodity || 'Unknown';
    }));
    return ['All', ...Array.from(c).sort()];
  }, [rawData, userAnnotations]);

  // Extract unique license types
  const licenseTypes = useMemo(() => {
    const t = new Set(rawData.map(item => {
      const annotation = userAnnotations[item.id] || {};
      return annotation.licenseType || item.licenseType || 'Unknown';
    }));
    return ['All', ...Array.from(t).sort()];
  }, [rawData, userAnnotations]);

  // Filter and Sort
  const processedData = useMemo(() => {
    let data = rawData;

    if (selectedCountry !== 'All') {
      data = data.filter(item => (item.country || 'Ghana') === selectedCountry);
    }

    if (selectedCommodity !== 'All') {
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const val = annotation.commodity || item.commodity || 'Unknown';
        return val === selectedCommodity;
      });
    }

    if (selectedLicenseType !== 'All') {
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const val = annotation.licenseType || item.licenseType || 'Unknown';
        return val === selectedLicenseType;
      });
    }

    if (filter) {
      const lower = filter.toLowerCase();
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const comment = annotation.comment || '';

        return (
          (item.company && item.company.toLowerCase().includes(lower)) ||
          (item.licenseType && item.licenseType.toLowerCase().includes(lower)) ||
          (comment.toLowerCase().includes(lower)) // Search within comments too
        );
      });
    }

    if (userStatusFilter !== 'All') {
      data = data.filter(item => {
        const status = userAnnotations[item.id]?.status;
        if (userStatusFilter === 'unmarked') return !status;
        return status === userStatusFilter;
      });
    }

    return data.sort((a, b) => {
      const valA = a[sortBy] ? a[sortBy].toString().toLowerCase() : '';
      const valB = b[sortBy] ? b[sortBy].toString().toLowerCase() : '';
      return valA.localeCompare(valB);
    });
  }, [rawData, filter, sortBy, selectedCountry, selectedCommodity, selectedLicenseType, userAnnotations, userStatusFilter]);

  const mapCenter = [7.9465, -1.0232]; // Ghana center

  return (
    <div className="app-container">
      <AddLicenseModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleCreateLicense}
      />

      <div className="sidebar">
        <div className="header">
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
          {processedData.map((item, idx) => {
            const annotation = userAnnotations[item.id] || {};
            const statusColor = annotation.status === 'good' ? '#22c55e' :
              annotation.status === 'bad' ? '#ef4444' :
                annotation.status === 'maybe' ? '#f59e0b' : 'transparent';
            const isHovered = hoveredItem === item.id;
            const isSelected = selectedItem?.id === item.id;

            return (
              <div
                key={idx}
                className="list-item"
                style={{
                  borderLeft: `4px solid ${statusColor}`,
                  backgroundColor: (isHovered || isSelected) ? '#1e293b' : 'transparent',
                  transform: isHovered ? 'translateX(4px)' : 'none',
                  transition: 'all 0.2s ease'
                }}
                onClick={() => setSelectedItem(item)}
                onMouseEnter={() => setHoveredItem(item.id)}
                onMouseLeave={() => setHoveredItem(null)}
              >
                <h3>{item.company}</h3>
                <div className="badges">
                  <span className="badge status">{item.status}</span>
                  <span className="badge type">{item.commodity}</span>
                </div>
                <p className="details">{item.region} | {annotation.licenseType || item.licenseType}</p>
                {item.phoneNumber && (
                  <div style={{ fontSize: '0.85em', color: '#64748b', marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px' }}>
                    <span>📞</span> <a href={`tel:${item.phoneNumber}`} onClick={(e) => e.stopPropagation()} style={{ color: '#2563eb', textDecoration: 'none' }}>{item.phoneNumber}</a>
                    {item.contactPerson && <span style={{ color: '#94a3b8' }}>• {item.contactPerson}</span>}
                  </div>
                )}
                {annotation.comment && <p className="user-comment">📝 {annotation.comment}</p>}

                {annotation.status && <div className="user-tag" style={{ color: statusColor, fontWeight: 'bold', fontSize: '0.8em', marginTop: '4px' }}>
                  {annotation.status === 'good' ? '✅ GO' :
                    annotation.status === 'bad' ? '❌ NO GO' :
                      annotation.status === 'maybe' ? '🤔 MAYBE' : ''}
                </div>}

                {(annotation.quantity || annotation.price) && (
                  <div className="order-summary" style={{ marginTop: '5px', fontSize: '0.85em', color: '#cbd5e1', borderTop: '1px solid #334155', paddingTop: '4px' }}>
                    {annotation.quantity && <div>Qty: <strong>{annotation.quantity}</strong></div>}
                    {annotation.price && <div>Price: <strong>${annotation.price}</strong></div>}
                    {(annotation.quantity && annotation.price) && (
                      <div style={{ color: '#fbbf24', marginTop: '2px' }}>
                        Total: <strong>${(parseFloat(annotation.quantity) * parseFloat(annotation.price)).toLocaleString()}</strong>
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {loading && <div className="status-message">Loading data...</div>}
          {error && <div className="error-message">{error}</div>}
          {!loading && !error && processedData.length === 0 && <div className="empty-state">No results found (Raw: {rawData.length})</div>}
        </div>
      </div>

      <div className="map-wrapper">
        <MapContainer center={mapCenter} zoom={7} style={{ height: '100%', width: '100%' }}>
          <MapEffect selectedItem={selectedItem} />
          <LayersControl position="topright">
            <LayersControl.BaseLayer checked name="Dark Matter (Default)">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png"
                maxNativeZoom={19}
                maxZoom={25}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Light (Clean)">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
                url="https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png"
                maxNativeZoom={19}
                maxZoom={25}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Topographic (Terrain)">
              <TileLayer
                attribution='Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)'
                url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
                maxNativeZoom={17}
                maxZoom={25}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="NatGeo (Esri)">
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; National Geographic, Esri, DeLorme, NAVTEQ, UNEP-WCMC, USGS, NASA, ESA, METI, NRCAN, GEBCO, NOAA, iPC'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/NatGeo_World_Map/MapServer/tile/{z}/{y}/{x}"
                maxNativeZoom={16}
                maxZoom={25}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Satellite (Esri)">
              <TileLayer
                attribution='Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
                url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
                maxNativeZoom={19}
                maxZoom={25}
              />
            </LayersControl.BaseLayer>

            <LayersControl.BaseLayer name="Street Map (Color)">
              <TileLayer
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                maxNativeZoom={19}
                maxZoom={25}
              />
            </LayersControl.BaseLayer>
          </LayersControl>
          <MarkerClusterGroup
            chunkedLoading
            spiderfyOnMaxZoom={true}
            showCoverageOnHover={false}
          >
            {processedData.map((item, idx) => {
              if (!item.lat || !item.lng) return null;
              const annotation = userAnnotations[item.id] || {};
              const isHovered = hoveredItem === item.id;

              return (
                <Marker
                  key={idx}
                  position={[item.lat, item.lng]}
                  icon={createCustomIcon(getMarkerColor(item.commodity, annotation.status), isHovered)}
                  zIndexOffset={isHovered ? 1000 : 0} // Bring to front on hover
                >
                  <Popup>
                    <PopupForm
                      item={item}
                      annotation={annotation}
                      updateAnnotation={updateAnnotation}
                      onDelete={() => deleteLicense(item.id)}
                    />
                  </Popup>
                </Marker>
              );
            })}
          </MarkerClusterGroup>
        </MapContainer>
      </div>
    </div>
  );
}

export default App;
