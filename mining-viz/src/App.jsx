import { useState, useMemo, useEffect } from 'react';
import 'leaflet/dist/leaflet.css';
import './App.css';

// Components
import Sidebar from './components/Sidebar';
import MapComponent from './components/MapComponent';
import DossierView from './components/DossierView';
import PopupForm from './components/PopupForm';
import AddLicenseModal from './components/AddLicenseModal';

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

  // New: Dossier State
  const [isDossierOpen, setIsDossierOpen] = useState(false);

  // Open dossier when item selected from map or list? 
  // Maybe just from list double click or separate button? 
  // For now, let's say selecting an item opens it if not on map?
  // Let's add an explicit "Open Dossier" button in the popup or list.
  // Actually, let's make the list item click open the Dossier INSTEAD of just selecting on map?
  // Or maybe clicking "Details" on popup opens Dossier.

  // Let's have `selectedItem` drive the map flyTo.
  // And `dossierItem` (which could be the same) drive the panel.
  const [dossierItem, setDossierItem] = useState(null);

  const handleOpenDossier = (item) => {
    setDossierItem(item);
    setIsDossierOpen(true);
  };

  const handleCloseDossier = () => {
    setIsDossierOpen(false);
    setDossierItem(null);
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

      <DossierView
        isOpen={isDossierOpen}
        onClose={handleCloseDossier}
        item={dossierItem}
        annotation={dossierItem ? (userAnnotations[dossierItem.id] || {}) : {}}
        updateAnnotation={updateAnnotation}
      />

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
          // handleOpenDossier(item); 
          // Optional: Open dossier on list click or just map flyto? 
          // Let's decide: List click = Map FlyTo + Open Dossier
          handleOpenDossier(item);
        }}
        hoveredItem={hoveredItem} setHoveredItem={setHoveredItem}
        userAnnotations={userAnnotations} rawData={rawData} error={error}
      />

      <MapComponent
        processedData={processedData}
        userAnnotations={userAnnotations}
        selectedItem={selectedItem}
        setSelectedItem={(item) => {
          setSelectedItem(item);
          // handleOpenDossier(item); // Optional: Open dossier on map click?
        }}
        mapCenter={mapCenter}
        PopupForm={PopupForm}
        updateAnnotation={updateAnnotation}
        deleteLicense={deleteLicense}
      />
    </div>
  );
}

export default App;
