import { useState } from 'react';
import { X } from 'lucide-react';

export default function ListingModal({ isOpen, onClose, onSubmit, meetingPoints, initialLocation, initialListing }) {
    const [product, setProduct] = useState(initialListing ? initialListing.product : 'Gold');
    const [shape, setShape] = useState(initialListing ? initialListing.shape : 'Dore Bar');
    const [quantity, setQuantity] = useState(initialListing ? initialListing.quantity : '');
    const [price, setPrice] = useState(initialListing ? initialListing.price_per_kg : '');
    const [meetingPointId, setMeetingPointId] = useState(initialListing ? initialListing.meeting_point_id : '');
    const [meetingDate, setMeetingDate] = useState(initialListing && initialListing.meeting_date ? new Date(initialListing.meeting_date).toISOString().slice(0, 16) : '');
    const [photo, setPhoto] = useState(null);
    const [uploading, setUploading] = useState(false);

    if (!isOpen) return null;

    const handleSubmit = (e) => {
        e.preventDefault();
        setUploading(true);
        const payload = {
            product,
            shape,
            quantity: parseFloat(quantity),
            price_per_kg: parseFloat(price),
            meeting_point_id: meetingPointId,
            meeting_date: meetingDate,
            photoFile: photo
        };

        if (initialListing) {
            payload.id = initialListing.id;
        } else {
            payload.lat = initialLocation.lat;
            payload.lng = initialLocation.lng;
        }

        onSubmit(payload).finally(() => {
            setUploading(false);
            onClose();
        });
    };

    return (
        <div className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4">
            <div className="bg-slate-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden border border-slate-700">
                <div className="px-6 py-4 flex justify-between items-center bg-slate-900 border-b border-slate-700">
                    <h2 className="text-xl font-bold text-white">{initialListing ? 'Edit Listing' : 'Create Listing'}</h2>
                    <button onClick={onClose} className="text-slate-400 hover:text-white transition">
                        <X size={24} />
                    </button>
                </div>

                <form onSubmit={handleSubmit} className="p-6 space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Product</label>
                            <select value={product} onChange={e => setProduct(e.target.value)} className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500">
                                <option value="Gold">Gold</option>
                                <option value="Silver">Silver</option>
                                <option value="Platinum">Platinum</option>
                                <option value="Other">Other</option>
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Shape</label>
                            <select value={shape} onChange={e => setShape(e.target.value)} className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500">
                                <option value="Dore Bar">Dore Bar</option>
                                <option value="Bullion">Bullion</option>
                                <option value="Dust">Dust</option>
                                <option value="Nugget">Nugget</option>
                            </select>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Quantity (kg)</label>
                            <input type="number" step="0.01" value={quantity} onChange={e => setQuantity(e.target.value)} required min="0" placeholder="e.g. 1.5"
                                className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500" />
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Price / kg (USD)</label>
                            <input type="number" step="0.01" value={price} onChange={e => setPrice(e.target.value)} required min="0" placeholder="e.g. 60000"
                                className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500" />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Destination</label>
                            <select value={meetingPointId} onChange={e => setMeetingPointId(e.target.value)} required className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500">
                                <option value="" disabled>Select a location...</option>
                                {meetingPoints.map(mp => (
                                    <option key={mp.id} value={mp.id}>{mp.name} {mp.address ? `(${mp.address})` : ''}</option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="block text-sm font-medium text-slate-300 mb-1">Meeting Date Mode</label>
                            <input type="datetime-local" value={meetingDate} onChange={e => setMeetingDate(e.target.value)} required
                                className="w-full p-2.5 rounded-lg bg-slate-900 border border-slate-700 text-white focus:outline-none focus:border-amber-500" />
                        </div>
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-slate-300 mb-1">Upload Photo {initialListing && '(Leave empty to keep existing)'}</label>
                        <input type="file" accept="image/*" onChange={e => setPhoto(e.target.files[0])} required={!initialListing}
                            className="w-full p-2 text-sm text-slate-300 file:mr-4 file:py-2 flex file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-amber-500 file:text-slate-900 hover:file:bg-amber-600 cursor-pointer border border-slate-700 rounded-lg bg-slate-900" />
                    </div>

                    <div className="mt-8 pt-4 border-t border-slate-700 flex justify-end">
                        <button type="submit" disabled={uploading} className="bg-amber-500 hover:bg-amber-600 text-slate-900 font-bold py-2.5 px-6 rounded-lg transition disabled:opacity-50 flex items-center gap-2">
                            {uploading ? 'Processing...' : (initialListing ? 'Update Listing' : 'Submit Listing & Get Route')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
