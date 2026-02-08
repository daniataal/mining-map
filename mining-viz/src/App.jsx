import { useState, useMemo, useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import './App.css';
import { useToast } from './components/Toast';

// Components
import Sidebar from './components/Sidebar';
import MapComponent from './components/MapComponent';
import DossierView from './components/DossierView';
import PopupForm from './components/PopupForm';
import AddLicenseModal from './components/AddLicenseModal';
import KanbanBoard from './components/KanbanBoard';
import AuthOverlay from './components/AuthOverlay';
import AdminPanel from './components/AdminPanel';

function App() {
  const { addToast } = useToast();
  const [rawData, setRawData] = useState([]);
  const [filter, setFilter] = useState('');
  const [sortBy, setSortBy] = useState('company');
  const [selectedCountry, setSelectedCountry] = useState([]);
  const [selectedCommodity, setSelectedCommodity] = useState([]);
  const [selectedLicenseType, setSelectedLicenseType] = useState([]);
  const [userStatusFilter, setUserStatusFilter] = useState([]);
  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [viewMode, setViewMode] = useState('map'); // 'map' or 'pipeline'
  const [mobileTab, setMobileTab] = useState('map'); // 'map', 'list', 'pipeline'
  const [isMobile, setIsMobile] = useState(window.innerWidth < 768);
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);

  // Auth State
  const [token, setToken] = useState(null);
  const [userRole, setUserRole] = useState(null);
  const [username, setUsername] = useState(null);
  const [userId, setUserId] = useState(null);
  const [authError, setAuthError] = useState(null);
  const [isAdminPanelOpen, setIsAdminPanelOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', handleResize);

    // Restore session
    const savedToken = localStorage.getItem('mining_token');
    if (savedToken) {
      setToken(savedToken);
      setUserRole(localStorage.getItem('mining_role'));
      setUsername(localStorage.getItem('mining_username'));
      setUserId(localStorage.getItem('mining_userid'));
    }

    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Interaction states
  const [selectedItem, setSelectedItem] = useState(null);
  const [hoveredItem, setHoveredItem] = useState(null);

  // New: Dossier State
  const [isDossierOpen, setIsDossierOpen] = useState(false);
  const [dossierItem, setDossierItem] = useState(null);
  const [mapFlyTrigger, setMapFlyTrigger] = useState(0); // Trigger map animations only when desired

  // Get API base URL from env or default to dynamic hostname
  // If we are on HTTPS, assume we are behind a proxy that handles /api routing or similar
  const API_BASE = import.meta.env.VITE_API_BASE ||
    (window.location.protocol === 'https:' ? '' : `http://${window.location.hostname}:8000`);

  // --- Auth & Logging ---

  const handleLogout = () => {
    // Clear session
    localStorage.removeItem('mining_token');
    localStorage.removeItem('mining_role');
    localStorage.removeItem('mining_username');
    localStorage.removeItem('mining_userid');

    setToken(null);
    setUserRole(null);
    setUsername(null);
    setUserId(null);
  };

  const handleLogin = (user, pass) => {
    fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: user, password: pass })
    })
      .then(res => {
        if (res.ok) return res.json();
        throw new Error('Invalid credentials');
      })
      .then(data => {
        // Persist session
        localStorage.setItem('mining_token', data.access_token);
        localStorage.setItem('mining_role', data.role);
        localStorage.setItem('mining_username', data.username);
        localStorage.setItem('mining_userid', data.id);

        setToken(data.access_token);
        setUserRole(data.role);
        setUsername(data.username);
        setUserId(data.id);
        setAuthError(null);
        logActivity(data.id, data.username, 'LOGIN', 'User logged in');
      })
      .catch(err => setAuthError(err.message));
  };

  const logActivity = (uid, uName, action, details) => {
    if (!uid) return;
    fetch(`${API_BASE}/activity/log`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        user_id: uid,
        username: uName,
        action: action,
        details: details
      })
    }).catch(err => console.warn("Log failed", err));
  };

  const handleOpenDossier = (item) => {
    setDossierItem(item);
    setIsDossierOpen(true);
    logActivity(userId, username, 'VIEW_DOSSIER', `Viewed ${item.company} (${item.id})`);
  };

  const handleCloseDossier = () => {
    setIsDossierOpen(false);
    setDossierItem(null);
  };

  const handleOpenPopup = (item) => {
    // pinpoint on map
    if (!item) return;
    setSelectedItem(item);
    setIsDossierOpen(false);
    setMapFlyTrigger(prev => prev + 1);
    logActivity(userId, username, 'LOCATE_ON_MAP', `Located ${item.company}`);
  };

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

  const deleteLicense = (id) => {
    if (!confirm("Are you sure you want to delete this license?")) return;

    fetch(`${API_BASE}/licenses/${id}`, { method: 'DELETE' })
      .then(res => {
        if (!res.ok) throw new Error("Failed to delete");
        setRawData(prev => prev.filter(item => item.id !== id));
        setSelectedItem(null);
        logActivity(userId, username, 'DELETE_LICENSE', `Deleted license ${id}`);
        addToast("License deleted", "info");
      })
      .catch(err => addToast("Error deleting license: " + err.message, "error"));
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
        addToast(`Successfully deleted ${data.deleted_count} licenses.`, "success");
        setRawData(prev => prev.filter(item => !idsToDelete.includes(item.id)));
        setSelectedItem(null);
        logActivity(userId, username, 'BATCH_DELETE', `Deleted ${data.deleted_count} licenses`);
      })
      .catch(err => addToast("Error batch deleting: " + err.message, "error"))
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
        addToast("License created successfully!", "success");
        logActivity(userId, username, 'CREATE_LICENSE', `Created ${data.company}`);
      })
      .catch(err => addToast("Error creating license: " + err.message, "error"));
  };

  const handleExport = () => {
    window.location.href = `${API_BASE}/licenses/export`;
    logActivity(userId, username, 'EXPORT', 'Exported CSV');
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
          addToast(`Successfully imported ${data.imported_count} licenses.`, "success");
          logActivity(userId, username, 'IMPORT', `Imported ${data.imported_count} items`);
          window.location.reload(); // Simple reload to fetch new data
        } else {
          addToast("Import failed: " + data.message, "error");
        }
      })
      .catch(err => addToast("Error importing: " + err.message, "error"))
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

  const updateAnnotation = (id, fieldOrUpdate, value) => {
    // Normalize arguments: support (id, field, value) OR (id, { field: value, ... })
    let updates = {};
    if (typeof fieldOrUpdate === 'string') {
      updates[fieldOrUpdate] = value;
    } else if (typeof fieldOrUpdate === 'object' && fieldOrUpdate !== null) {
      updates = fieldOrUpdate;
    }

    // 1. Update Local State (Immediate UI Feedback)
    setUserAnnotations(prev => {
      const prevItem = prev[id] || {};
      const nextItem = { ...prevItem, ...updates };

      const next = {
        ...prev,
        [id]: nextItem
      };
      localStorage.setItem('mining_user_data', JSON.stringify(next));
      return next;
    });

    // 2. Map Frontend Fields to Backend Model
    let backendPayload = {};

    // Iterate over all updates to build payload
    Object.entries(updates).forEach(([field, val]) => {
      if (field === 'price') {
        backendPayload.pricePerKg = parseFloat(val) || 0;
      } else if (field === 'quantity') {
        backendPayload.capacity = parseFloat(val) || 0;
      } else if (field === 'status') {
        // Map frontend status 'good'/'verified' to backend 'APPROVED' if needed, 
        // OR mostly just pass it through if the user selects "APPROVED" (which they might need a way to do).
        // The prompt implies "miner.status == APPROVED". 
        // The Popup has buttons for "Go" (good), "Maybe", "No" (bad).
        // We might need to interpret "good" as "APPROVED" or allow direct status setting.
        // For now, let's pass the value. Use uppercase for backend consistency if it matches standard statuses.
        backendPayload.status = val === 'good' ? 'APPROVED' : val;
        // Note: The UI separates "Go" (good) from the actual "status" badge. 
        // But let's assume "Go" == APPROVED for the export trigger.
      } else if (field === 'licenseType') {
        backendPayload.licenseType = val;
      } else if (field === 'commodity') {
        backendPayload.commodity = val;
      } else if (field === 'phoneNumber') {
        backendPayload.phoneNumber = val;
      } else if (field === 'contactPerson') {
        backendPayload.contactPerson = val;
      } else if (field === 'export_trigger') {
        backendPayload.export_trigger = true;
      }
    });

    // 3. Send to Backend
    if (Object.keys(backendPayload).length > 0) {
      fetch(`${API_BASE}/licenses/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(backendPayload)
      })
        .then(res => res.json())
        .then(data => {
          if (data.exported) {
            addToast("Miner exported to Marketplace!", "success");
            logActivity(userId, username, 'EXPORT_TRIGGER', `License ${id} exported`);
          }
          if (updates.status) {
            const val = updates.status;
            logActivity(userId, username, 'UPDATE_STATUS', `Set ${id} to ${val}`);
          }
        })
        .catch(err => console.error("Failed to sync annotation to backend:", err));
    }
  };

  // Extract unique countries
  const countries = useMemo(() => {
    const c = new Set(rawData.map(item => item.country || 'Ghana')); // Default to Ghana if missing
    return Array.from(c).sort();
  }, [rawData]);

  // Extract unique commodities
  const commodities = useMemo(() => {
    const c = new Set(rawData.map(item => {
      const annotation = userAnnotations[item.id] || {};
      return annotation.commodity || item.commodity || 'Unknown';
    }));
    return Array.from(c).sort();
  }, [rawData, userAnnotations]);

  // Extract unique license types
  const licenseTypes = useMemo(() => {
    const t = new Set(rawData.map(item => {
      const annotation = userAnnotations[item.id] || {};
      return annotation.licenseType || item.licenseType || 'Unknown';
    }));
    return Array.from(t).sort();
  }, [rawData, userAnnotations]);

  // Filter and Sort
  const processedData = useMemo(() => {
    let data = rawData;

    if (selectedCountry.length > 0) {
      data = data.filter(item => selectedCountry.includes(item.country || 'Ghana'));
    }

    if (selectedCommodity.length > 0) {
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const val = annotation.commodity || item.commodity || 'Unknown';
        return selectedCommodity.includes(val);
      });
    }

    if (selectedLicenseType.length > 0) {
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const val = annotation.licenseType || item.licenseType || 'Unknown';
        return selectedLicenseType.includes(val);
      });
    }

    if (filter) {
      const lower = filter.toLowerCase();
      data = data.filter(item => {
        const annotation = userAnnotations[item.id] || {};
        const comment = annotation.comment || '';
        const commodity = annotation.commodity || item.commodity || '';

        return (
          (item.company && item.company.toLowerCase().includes(lower)) ||
          (item.licenseType && item.licenseType.toLowerCase().includes(lower)) ||
          (commodity.toLowerCase().includes(lower)) ||
          (comment.toLowerCase().includes(lower)) // Search within comments too
        );
      });
    }

    if (userStatusFilter.length > 0) {
      data = data.filter(item => {
        const status = userAnnotations[item.id]?.status;
        if (userStatusFilter.includes('unmarked') && !status) return true;
        return userStatusFilter.includes(status);
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
    <div className={`app-container ${isMobile ? 'mobile-mode' : ''}`}>

      {/* Auth Overlay - Shows if not logged in */}
      {!token && (
        <AuthOverlay onLogin={handleLogin} error={authError} />
      )}

      {/* Admin Panel (Modal) */}
      <AdminPanel isOpen={isAdminPanelOpen} onClose={() => setIsAdminPanelOpen(false)} token={token} />

      {/* Admin Toggle Button (Floating) */}
      {userRole === 'admin' && !isMobile && (
        <button
          onClick={() => setIsAdminPanelOpen(true)}
          style={{
            position: 'fixed',
            bottom: '90px',
            right: '20px',
            zIndex: 9999,
            background: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '50px',
            height: '50px',
            fontSize: '1.5rem',
            cursor: 'pointer',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          title="Admin Panel"
        >
          ⚙️
        </button>
      )}

      {/* Mobile Admin Toggle (Bottom Nav Area? Or Top Right) */}
      {userRole === 'admin' && isMobile && (
        <button
          onClick={() => setIsAdminPanelOpen(true)}
          style={{
            position: 'fixed',
            bottom: '70px', // Adjusted to be above bottom nav (60px)
            right: '20px',
            zIndex: 9999,
            background: '#dc2626',
            color: 'white',
            border: 'none',
            borderRadius: '50%',
            width: '45px',
            height: '45px',
            fontSize: '1.2rem',
            cursor: 'pointer',
            boxShadow: '0 4px 10px rgba(0,0,0,0.5)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
          }}
          title="Admin Panel"
        >
          ⚙️
        </button>
      )}

      <AddLicenseModal
        isOpen={isAddModalOpen}
        onClose={() => setIsAddModalOpen(false)}
        onSubmit={handleCreateLicense}
      />

      <DossierView
        isOpen={isDossierOpen}
        onClose={handleCloseDossier}
        onOpenPopup={handleOpenPopup}
        item={dossierItem}
        annotation={dossierItem ? (userAnnotations[dossierItem.id] || {}) : {}}
        updateAnnotation={updateAnnotation}
      />

      <div className="sidebar-wrapper" style={{
        display: (isMobile && mobileTab !== 'list') || (!isMobile && isSidebarCollapsed) ? 'none' : 'block',
        width: isMobile ? '100%' : 'auto'
      }}>
        <Sidebar
          processedData={processedData}
          filter={filter} setFilter={setFilter}
          sortBy={sortBy} setSortBy={setSortBy}
          selectedCommodity={selectedCommodity} setSelectedCommodity={setSelectedCommodity}
          selectedCountry={selectedCountry} setSelectedCountry={setSelectedCountry}
          userStatusFilter={userStatusFilter} setUserStatusFilter={setUserStatusFilter}
          selectedLicenseType={selectedLicenseType} setSelectedLicenseType={setSelectedLicenseType}
          commodities={commodities} countries={countries} licenseTypes={licenseTypes}
          isAddModalOpen={isAddModalOpen} setIsAddModalOpen={setIsAddModalOpen}
          deleteFilteredList={deleteFilteredList} loading={loading}
          handleImport={handleImport} handleTemplate={handleTemplate} handleExport={handleExport}
          selectedItem={selectedItem} setSelectedItem={(item) => {
            setSelectedItem(item);
            handleOpenDossier(item);
            setMapFlyTrigger(prev => prev + 1); // Trigger map fly only from Sidebar
            logActivity(userId, username, 'SELECT_ITEM', `Selected ${item.company}`);
          }}
          hoveredItem={hoveredItem} setHoveredItem={setHoveredItem}
          userAnnotations={userAnnotations} rawData={rawData} error={error}
          onToggleCollapse={!isMobile ? () => setIsSidebarCollapsed(true) : undefined}
          onLogout={handleLogout}
        />
      </div>

      <div className="main-content" style={{
        flex: 1,
        position: 'relative',
        display: isMobile && (mobileTab === 'list') ? 'none' : 'flex',
        flexDirection: 'column'
      }}>
        {/* Restore Sidebar Button (Desktop Only) */}
        {!isMobile && isSidebarCollapsed && (
          <button
            onClick={() => setIsSidebarCollapsed(false)}
            style={{
              position: 'absolute',
              top: '80px', // Moved down
              left: '10px',
              zIndex: 2000,
              backgroundColor: '#1e293b',
              color: '#94a3b8',
              border: '1px solid #475569',
              padding: '8px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              boxShadow: '0 2px 5px rgba(0,0,0,0.2)'
            }}
            title="Show Sidebar"
          >
            »
          </button>
        )}

        {/* View Switcher - Floating on top (Hidden on Mobile) */}
        {!isMobile && (
          <div style={{
            position: 'absolute',
            top: '20px',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000,
            backgroundColor: 'var(--card-bg)',
            padding: '5px',
            borderRadius: '8px',
            display: 'flex',
            gap: '5px',
            boxShadow: '0 4px 6px rgba(0,0,0,0.3)',
            border: '1px solid var(--border-color)'
          }}>
            <button
              onClick={() => setViewMode('map')}
              style={{
                background: viewMode === 'map' ? 'var(--primary-color)' : 'transparent',
                color: viewMode === 'map' ? '#0d1117' : 'var(--text-muted)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              🗺️ Map
            </button>
            <button
              onClick={() => setViewMode('pipeline')}
              style={{
                background: viewMode === 'pipeline' ? 'var(--primary-color)' : 'transparent',
                color: viewMode === 'pipeline' ? '#0d1117' : 'var(--text-muted)',
                border: 'none',
                padding: '6px 12px',
                borderRadius: '6px',
                cursor: 'pointer',
                fontWeight: 'bold'
              }}
            >
              📊 Pipeline
            </button>
          </div>
        )}

        {viewMode === 'map' ? (
          <MapComponent
            processedData={processedData}
            userAnnotations={userAnnotations}
            selectedItem={selectedItem}
            mapFlyTrigger={mapFlyTrigger} // Pass the trigger
            setSelectedItem={(item) => {
              setSelectedItem(item);
              if (item) {
                if (!isMobile) handleOpenDossier(item);
                logActivity(userId, username, 'SELECT_MAP_PIN', `Selected ${item.company}`);
              } else {
                if (viewMode === 'map') handleCloseDossier(); // Optional: close dossier if deselected
              }
            }}
            handleOpenDossier={handleOpenDossier}
            mapCenter={mapCenter}
            PopupForm={PopupForm}
            updateAnnotation={updateAnnotation}
            deleteLicense={deleteLicense}
            commodities={commodities}
            licenseTypes={licenseTypes}
            isMobile={isMobile}
          />
        ) : (
          <KanbanBoard
            processedData={processedData}
            userAnnotations={userAnnotations}
            updateAnnotation={updateAnnotation}
            onCardClick={(item) => {
              setSelectedItem(item);
              if (!isMobile) handleOpenDossier(item);
            }}
            commodities={commodities}
            isMobile={isMobile}
          />
        )}
      </div>

      {/* Bottom Navigation for Mobile */}
      {isMobile && (
        <div className="bottom-nav">
          <button
            className={`nav-item ${mobileTab === 'list' ? 'active' : ''}`}
            onClick={() => setMobileTab('list')}
            style={{ color: mobileTab === 'list' ? 'var(--primary-color)' : 'var(--text-muted)' }}
          >
            <span className="nav-icon">📋</span>
            <span>List</span>
          </button>
          <button
            className={`nav-item ${mobileTab === 'map' ? 'active' : ''}`}
            onClick={() => {
              setMobileTab('map');
              setViewMode('map');
            }}
            style={{ color: mobileTab === 'map' ? 'var(--primary-color)' : 'var(--text-muted)' }}
          >
            <span className="nav-icon">🗺️</span>
            <span>Map</span>
          </button>
          <button
            className={`nav-item ${mobileTab === 'pipeline' ? 'active' : ''}`}
            onClick={() => {
              setMobileTab('pipeline');
              setViewMode('pipeline');
            }}
            style={{ color: mobileTab === 'pipeline' ? 'var(--primary-color)' : 'var(--text-muted)' }}
          >
            <span className="nav-icon">📊</span>
            <span>Pipeline</span>
          </button>
        </div>
      )}
    </div>
  );
}

export default App;
