import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Camera, LogOut, Check, X, Search, Crosshair } from 'lucide-react';
import L from 'leaflet';

import ListingModal from './components/ListingModal';
import RoutingControl from './components/RoutingControl';

// Fix Leaflet Default Icon issue
import icon from 'leaflet/dist/images/marker-icon.png';
import iconShadow from 'leaflet/dist/images/marker-shadow.png';
let DefaultIcon = L.icon({
  iconUrl: icon, shadowUrl: iconShadow, iconSize: [25, 41], iconAnchor: [12, 41], popupAnchor: [1, -34], tooltipAnchor: [16, -28], shadowSize: [41, 41]
});
L.Marker.prototype.options.icon = DefaultIcon;

// Custom Icons
const MinerIcon = new L.Icon({
  ...DefaultIcon.options, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-gold.png',
});
const MeetingPointIcon = new L.Icon({
  ...DefaultIcon.options, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-red.png',
});
const DraftIcon = new L.Icon({
  ...DefaultIcon.options, iconUrl: 'https://raw.githubusercontent.com/pointhi/leaflet-color-markers/master/img/marker-icon-2x-grey.png',
});


function MapEvents({ onMapClick }) {
  useMapEvents({
    click(e) { onMapClick(e.latlng); }
  });
  return null;
}

function MapUpdater({ center }) {
  const map = useMapEvents({});
  useEffect(() => {
    if (center) {
      map.flyTo(center, Math.max(map.getZoom(), 12));
    }
  }, [center, map]);
  return null;
}

export default function App() {
  const [token, setToken] = useState(localStorage.getItem('cm_token') || null);
  const [userId, setUserId] = useState(localStorage.getItem('cm_userid') || null);
  const [username, setUsername] = useState(localStorage.getItem('cm_username') || null);

  // Auth State
  const [authMode, setAuthMode] = useState('login');
  const [loginUser, setLoginUser] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [authError, setAuthError] = useState('');

  // Data State
  const [meetingPoints, setMeetingPoints] = useState([]);
  const [listings, setListings] = useState([]);

  // App State
  const [addingMode, setAddingMode] = useState(false);
  const [draftLocation, setDraftLocation] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingListing, setEditingListing] = useState(null);
  const [offerListing, setOfferListing] = useState(null);

  // Search State
  const [searchQuery, setSearchQuery] = useState('');
  const [mapCenter, setMapCenter] = useState([7.9465, -1.0232]);

  const [activeRoute, setActiveRoute] = useState(null); // { start: {lat, lng}, end: {lat, lng} }

  const API_BASE = import.meta.env.VITE_API_BASE || 'http://localhost:8000';

  useEffect(() => {
    if (token) {
      fetchData();
    }
  }, [token]);

  const fetchData = async () => {
    try {
      const [mpRes, listRes] = await Promise.all([
        fetch(`${API_BASE}/meeting-points`),
        fetch(`${API_BASE}/miner-listings?miner_id=${userId}`)
      ]);
      const mpData = await mpRes.json();
      const listData = await listRes.json();
      setMeetingPoints(Array.isArray(mpData) ? mpData : []);
      setListings(Array.isArray(listData) ? listData : []);
    } catch (e) {
      console.error('Failed to fetch data', e);
    }
  };

  const handleLogin = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass })
      });
      if (!res.ok) throw new Error('Invalid credentials');
      const data = await res.json();
      localStorage.setItem('cm_token', data.access_token);
      localStorage.setItem('cm_userid', data.id);
      localStorage.setItem('cm_username', data.username);
      setToken(data.access_token); setUserId(data.id); setUsername(data.username);
    } catch (err) { setAuthError(err.message); }
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    setAuthError('');
    try {
      const res = await fetch(`${API_BASE}/auth/register`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: loginUser, password: loginPass, phone_number: loginPhone, role: 'miner' })
      });
      if (!res.ok) {
        const txt = await res.text(); throw new Error(txt || 'Failed to register');
      }
      handleLogin(e);
    } catch (err) { setAuthError(err.message); }
  };

  const logout = () => {
    localStorage.removeItem('cm_token'); localStorage.removeItem('cm_userid'); localStorage.removeItem('cm_username');
    setToken(null); setUserId(null); setUsername(null);
  };

  const handleCreateListing = async (formData) => {
    try {
      // 1. Create listing
      const reqBody = {
        miner_id: userId,
        lat: formData.lat, lng: formData.lng,
        price_per_kg: formData.price_per_kg,
        quantity: formData.quantity,
        shape: formData.shape,
        product: formData.product,
        meeting_point_id: formData.meeting_point_id,
        meeting_date: formData.meeting_date
      };
      const res = await fetch(`${API_BASE}/miner-listings`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(reqBody)
      });
      if (!res.ok) throw new Error('Failed to create listing');
      const listingData = await res.json();

      // 2. Upload photo
      if (formData.photoFile) {
        const fileData = new FormData();
        fileData.append('file', formData.photoFile);
        const photoRes = await fetch(`${API_BASE}/miner-listings/${listingData.id}/photo`, {
          method: 'POST', body: fileData
        });
        if (!photoRes.ok) throw new Error('Failed to upload photo');
      }

      await fetchData();
      setAddingMode(false);
      setDraftLocation(null);

      // Auto-start route
      const mp = meetingPoints.find(m => m.id === formData.meeting_point_id);
      if (mp) {
        setActiveRoute({ start: { lat: formData.lat, lng: formData.lng }, end: { lat: mp.lat, lng: mp.lng } });
      }

    } catch (err) {
      alert(err.message);
    }
  };

  const handleEditListing = async (formData) => {
    try {
      const { id, photoFile, ...updateBody } = formData;
      const res = await fetch(`${API_BASE}/miner-listings/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateBody)
      });
      if (!res.ok) throw new Error('Failed to update listing');

      if (photoFile) {
        const fileData = new FormData();
        fileData.append('file', photoFile);
        const photoRes = await fetch(`${API_BASE}/miner-listings/${id}/photo`, {
          method: 'POST', body: fileData
        });
        if (!photoRes.ok) throw new Error('Failed to update photo');
      }

      await fetchData();
      setEditingListing(null);

    } catch (err) {
      alert(err.message);
    }
  };

  const handleDeleteListing = async (id) => {
    if (!confirm('Are you sure you want to delete this listing?')) return;
    try {
      const res = await fetch(`${API_BASE}/miner-listings/${id}`, {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to delete listing');

      // If the deleted listing is currently the active route, clear it
      if (activeRoute && listings.find(l => l.id === id)) {
        setActiveRoute(null);
      }

      await fetchData();
    } catch (err) {
      alert(err.message);
    }
  };

  const handleAcceptOffer = async (id) => {
    try {
      const res = await fetch(`${API_BASE}/miner-listings/${id}/accept-offer`, {
        method: 'POST'
      });
      if (!res.ok) throw new Error('Failed to accept offer');
      await fetchData();
      setOfferListing(null);
      alert('Offer accepted successfully!');
    } catch (err) {
      alert(err.message);
    }
  };

  const startRoute = (listing) => {
    const mp = meetingPoints.find(m => m.id === listing.meeting_point_id);
    if (!mp) return alert('Meeting point not found');
    setActiveRoute({ start: { lat: listing.lat, lng: listing.lng }, end: { lat: mp.lat, lng: mp.lng } });
  };

  const handleGeolocation = () => {
    if (!navigator.geolocation) {
      alert("Geolocation is not supported by your browser");
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude } = position.coords;
        setMapCenter([latitude, longitude]);
        setDraftLocation({ lat: latitude, lng: longitude });
        setAddingMode(true);
      },
      (error) => {
        alert("Unable to retrieve your location: " + error.message);
      }
    );
  };

  const handleAddressSearch = async () => {
    if (!searchQuery.trim()) return;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(searchQuery)}`);
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        setMapCenter([lat, lon]);
        setDraftLocation({ lat, lng: lon });
        setAddingMode(true);
      } else {
        alert("Address not found.");
      }
    } catch (err) {
      alert("Error searching address: " + err.message);
    }
  };

  if (!token) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-900 text-slate-100 p-4">
        <div className="bg-slate-800 p-8 rounded-2xl shadow-2xl w-full max-w-md border border-slate-700">
          <div className="flex justify-center mb-6">
            <div className="w-16 h-16 bg-amber-500 rounded-full flex items-center justify-center">
              <MapPin className="w-8 h-8 text-slate-900" />
            </div>
          </div>
          <h1 className="text-3xl font-bold text-center mb-2 tracking-tight">Miner Connect</h1>
          <p className="text-slate-400 text-center mb-8">Share resources, connect with buyers.</p>

          <form onSubmit={authMode === 'login' ? handleLogin : handleRegister} className="flex flex-col gap-4">
            <div>
              <label className="text-sm font-medium text-slate-300">Username</label>
              <input
                type="text" value={loginUser} onChange={e => setLoginUser(e.target.value)} required
                className="w-full mt-1 p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            <div>
              <label className="text-sm font-medium text-slate-300">Password</label>
              <input
                type="password" value={loginPass} onChange={e => setLoginPass(e.target.value)} required
                className="w-full mt-1 p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500"
              />
            </div>
            {authMode === 'register' && (
              <div>
                <label className="text-sm font-medium text-slate-300">Phone Number</label>
                <input
                  type="tel" value={loginPhone} onChange={e => setLoginPhone(e.target.value)} required
                  placeholder="+1..."
                  className="w-full mt-1 p-3 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500"
                />
              </div>
            )}
            {authError && <p className="text-red-400 text-sm font-medium">{authError}</p>}
            <button className="w-full mt-2 bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-3.5 px-4 rounded-xl transition text-lg tracking-wide uppercase">
              {authMode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
            <p className="text-center text-sm text-slate-400 mt-4 cursor-pointer hover:text-white" onClick={() => setAuthMode(authMode === 'login' ? 'register' : 'login')}>
              {authMode === 'login' ? "Don't have an account? Sign up" : "Already have an account? Sign in"}
            </p>
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-screen bg-slate-50 text-slate-900">
      <header className="bg-slate-900 text-white p-4 flex justify-between items-center shadow-lg z-50">
        <div className="flex items-center gap-2">
          <MapPin className="text-amber-500" />
          <h1 className="font-bold text-xl tracking-tight">Miner Connect</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-sm font-medium text-slate-300 hidden sm:block">Logged in as: <span className="text-white font-bold">{username}</span></span>
          <button onClick={logout} className="p-2 hover:bg-slate-800 rounded-full transition"><LogOut size={18} /></button>
        </div>
      </header>

      <main className="flex-1 relative">
        {/* Location Search Bar */}
        <div className="absolute top-4 w-[90%] max-w-md left-1/2 transform -translate-x-1/2 z-[1000]">
          <div className="bg-slate-900 rounded-full shadow-2xl border border-slate-700 p-2 flex items-center gap-2">
            <button onClick={handleGeolocation} className="p-2 text-amber-500 hover:bg-slate-800 rounded-full transition" title="Use My Location">
              <Crosshair size={20} />
            </button>
            <div className="h-6 w-px bg-slate-700"></div>
            <input
              type="text"
              placeholder="Search street, city, etc..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleAddressSearch()}
              className="flex-1 bg-transparent text-white placeholder-slate-400 focus:outline-none px-2 text-sm"
            />
            <button onClick={handleAddressSearch} className="p-2 bg-amber-500 hover:bg-amber-600 text-slate-900 rounded-full transition" title="Search">
              <Search size={16} />
            </button>
          </div>
        </div>

        {addingMode && (
          <div className="absolute top-20 left-1/2 transform -translate-x-1/2 z-[1000] bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl border border-slate-700 flex items-center gap-2 animate-bounce">
            <MapPin size={18} className="text-amber-500" />
            <span className="font-medium text-sm">Tap on the map to place your listing</span>
          </div>
        )}

        {draftLocation && !editingListing && (
          <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 z-[1000] bg-slate-800 p-4 rounded-xl shadow-2xl border border-slate-700 flex items-center gap-4 w-[90%] max-w-sm">
            <button onClick={() => { setDraftLocation(null); setAddingMode(false); }} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm font-medium flex justify-center items-center gap-2 transition">
              <X size={16} /> Cancel
            </button>
            <button onClick={() => setIsModalOpen(true)} className="flex-[2] bg-amber-500 hover:bg-amber-600 text-slate-900 py-2 rounded-lg text-sm font-bold flex justify-center items-center gap-2 transition">
              <Check size={16} /> Confirm Location
            </button>
          </div>
        )}

        <MapContainer center={mapCenter} zoom={6} scrollWheelZoom={true} className="h-full w-full z-0">
          <MapUpdater center={mapCenter} />
          <TileLayer
            attribution='&copy; <a href="https://carto.com/">CARTO</a>'
            url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png"
          />

          <MapEvents onMapClick={(latlng) => {
            if (addingMode && !isModalOpen) {
              setDraftLocation(latlng);
            }
          }} />

          {/* Meeting Points */}
          {meetingPoints.map(mp => (
            <Marker key={mp.id} position={[mp.lat, mp.lng]} icon={MeetingPointIcon}>
              <Popup>
                <div className="p-1">
                  <h3 className="font-bold text-slate-900">{mp.name}</h3>
                  <p className="text-sm text-slate-600">{mp.address}</p>
                  <p className="text-xs text-amber-600 font-semibold mt-1">Status: {mp.status}</p>
                </div>
              </Popup>
            </Marker>
          ))}

          {/* User Listings */}
          {listings.map(l => (
            <Marker key={l.id} position={[l.lat, l.lng]} icon={MinerIcon}>
              <Popup>
                <div className="p-1 min-w-[150px]">
                  <h3 className="font-bold text-slate-900 border-b pb-1 mb-2">{l.product} - {l.shape}</h3>
                  <div className="text-sm space-y-1">
                    <p><span className="text-slate-500">Qty:</span> {l.quantity} kg</p>
                    <p><span className="text-slate-500">Price:</span> ${l.price_per_kg}/kg</p>
                    {l.meeting_date && <p><span className="text-slate-500">Date:</span> {new Date(l.meeting_date).toLocaleString()}</p>}
                    <p>
                      <span className="text-slate-500">Status: </span>
                      <span className={l.status === 'VERIFIED' ? 'text-green-600 font-bold' : (l.status === 'REJECTED' ? 'text-red-600 font-bold' : 'text-amber-600 font-bold')}>{l.status}</span>
                    </p>
                  </div>
                  <button onClick={() => startRoute(l)} className="mt-3 w-full bg-slate-900 text-white text-xs font-semibold py-2 rounded-md hover:bg-slate-800 transition flex justify-center items-center gap-1">
                    <Navigation size={12} /> View Route
                  </button>
                  {l.status === 'OFFER' && l.miner_id === userId && (
                    <button onClick={() => setOfferListing(l)} className="mt-2 w-full bg-amber-500 text-slate-900 text-xs font-bold py-2 rounded-md hover:bg-amber-600 transition flex justify-center items-center shadow-md">
                      ⚖️ Review Offer
                    </button>
                  )}
                  {l.miner_id === userId && (
                    <div className="flex gap-2 mt-2">
                      <button onClick={() => { setEditingListing(l); setIsModalOpen(true); }} className="flex-1 bg-slate-200 text-slate-800 text-xs font-semibold py-1.5 rounded-md hover:bg-slate-300 transition">
                        Edit
                      </button>
                      <button onClick={() => handleDeleteListing(l.id)} className="flex-1 bg-red-100 text-red-600 text-xs font-semibold py-1.5 rounded-md hover:bg-red-200 transition">
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              </Popup>
            </Marker>
          ))}

          {/* Draft Marker */}
          {draftLocation && (
            <Marker position={[draftLocation.lat, draftLocation.lng]} icon={DraftIcon} />
          )}

          {/* Routing Machine */}
          {activeRoute && <RoutingControl startNode={activeRoute.start} endNode={activeRoute.end} />}
        </MapContainer>

        {/* Floating Action Button for New Listing */}
        {!addingMode && !activeRoute && (
          <div className="absolute bottom-6 right-6 z-[1000]">
            <button onClick={() => setAddingMode(true)} className="bg-amber-500 hover:bg-amber-600 text-slate-900 shadow-[0_10px_25px_-5px_rgba(245,158,11,0.5)] rounded-full p-4 flex items-center justify-center transition transform hover:scale-105">
              <Camera size={28} />
            </button>
          </div>
        )}

        {/* Clear Route Button */}
        {activeRoute && (
          <div className="absolute bottom-6 right-6 z-[1000]">
            <button onClick={() => setActiveRoute(null)} className="bg-slate-900 hover:bg-slate-800 text-white shadow-xl rounded-full px-6 py-3 flex items-center justify-center transition gap-2 font-medium">
              <X size={20} /> Clear Route
            </button>
          </div>
        )}
      </main>

      {/* Offer Review Modal */}
      {offerListing && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-[2000] flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl w-full max-w-md overflow-hidden shadow-2xl animate-fade-in-up">
            <div className="bg-amber-500 p-4 text-center">
              <h2 className="text-xl font-bold text-slate-900">Official Offer</h2>
              <p className="text-amber-900 text-sm font-medium">From DoreMarket Trading Auth</p>
            </div>
            <div className="p-6">
              <div className="space-y-4 mb-6">
                <div className="flex justify-between items-center border-b pb-2">
                  <span className="text-slate-500 font-medium">Tested Weight</span>
                  <span className="text-slate-900 font-bold">{offerListing.tested_weight} kg</span>
                </div>
                <div className="flex justify-between items-center border-b pb-2">
                  <span className="text-slate-500 font-medium">Tested Purity</span>
                  <span className="text-slate-900 font-bold">{(offerListing.tested_purity * 100).toFixed(2)}%</span>
                </div>
                <div className="flex justify-between items-center bg-slate-50 p-3 rounded-lg border border-slate-200">
                  <span className="text-slate-600 font-bold text-lg">Final Offer</span>
                  <span className="text-green-600 font-black text-2xl">${offerListing.final_offer.toLocaleString()}</span>
                </div>
              </div>

              <div className="flex gap-3">
                <button onClick={() => setOfferListing(null)} className="flex-1 py-3 bg-slate-100 hover:bg-slate-200 text-slate-700 font-bold rounded-xl transition">
                  Close
                </button>
                <button onClick={() => handleAcceptOffer(offerListing.id)} className="flex-[2] py-3 bg-green-500 hover:bg-green-600 text-white font-bold rounded-xl shadow-lg shadow-green-500/30 transition flex justify-center items-center gap-2">
                  <Check size={18} /> Accept Offer
                </button>
              </div>
              <p className="text-center text-xs text-slate-400 mt-4 px-4">By accepting this offer, an overarching agreement and inventory transfer will be initiated automatically.</p>
            </div>
          </div>
        </div>
      )}

      {/* Listing Modal */}
      <ListingModal
        isOpen={isModalOpen}
        onClose={() => { setIsModalOpen(false); setEditingListing(null); }}
        onSubmit={editingListing ? handleEditListing : handleCreateListing}
        meetingPoints={meetingPoints}
        initialLocation={draftLocation}
        initialListing={editingListing}
      />
    </div>
  );
}
