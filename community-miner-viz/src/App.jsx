import { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Camera, LogOut, Check, X } from 'lucide-react';
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


// Helper component for map clicks
function MapEvents({ onMapClick }) {
  useMapEvents({
    click(e) { onMapClick(e.latlng); }
  });
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
  const [authError, setAuthError] = useState('');

  // Data State
  const [meetingPoints, setMeetingPoints] = useState([]);
  const [listings, setListings] = useState([]);

  // App State
  const [addingMode, setAddingMode] = useState(false);
  const [draftLocation, setDraftLocation] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);

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
        body: JSON.stringify({ username: loginUser, password: loginPass, role: 'miner' })
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

  const startRoute = (listing) => {
    const mp = meetingPoints.find(m => m.id === listing.meeting_point_id);
    if (!mp) return alert('Meeting point not found');
    setActiveRoute({ start: { lat: listing.lat, lng: listing.lng }, end: { lat: mp.lat, lng: mp.lng } });
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
        {addingMode && (
          <div className="absolute top-4 left-1/2 transform -translate-x-1/2 z-[1000] bg-slate-900 text-white px-6 py-3 rounded-full shadow-2xl border border-slate-700 flex items-center gap-2 animate-bounce">
            <MapPin size={18} className="text-amber-500" />
            <span className="font-medium text-sm">Tap on the map to place your listing</span>
          </div>
        )}

        {draftLocation && (
          <div className="absolute bottom-24 left-1/2 transform -translate-x-1/2 z-[1000] bg-slate-800 p-4 rounded-xl shadow-2xl border border-slate-700 flex items-center gap-4 w-[90%] max-w-sm">
            <button onClick={() => { setDraftLocation(null); setAddingMode(false); }} className="flex-1 bg-slate-700 hover:bg-slate-600 text-white py-2 rounded-lg text-sm font-medium flex justify-center items-center gap-2 transition">
              <X size={16} /> Cancel
            </button>
            <button onClick={() => setIsModalOpen(true)} className="flex-[2] bg-amber-500 hover:bg-amber-600 text-slate-900 py-2 rounded-lg text-sm font-bold flex justify-center items-center gap-2 transition">
              <Check size={16} /> Confirm Location
            </button>
          </div>
        )}

        <MapContainer center={[7.9465, -1.0232]} zoom={6} scrollWheelZoom={true} className="h-full w-full z-0">
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

      {/* Listing Modal */}
      <ListingModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        onSubmit={handleCreateListing}
        meetingPoints={meetingPoints}
        initialLocation={draftLocation}
      />
    </div>
  );
}
