import { useState } from 'react';
import { useI18n } from '../lib/i18n';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from './ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { countriesList } from '../data/countries';

interface AddLicenseModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (item: any) => void;
}

export default function AddLicenseModal({ isOpen, onClose, onSubmit }: AddLicenseModalProps) {
    const { t } = useI18n();
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

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        onSubmit({
            ...formData,
            lat: parseFloat(formData.lat),
            lng: parseFloat(formData.lng)
        });
        onClose();
    };

    return (
        <Dialog open={isOpen} onOpenChange={onClose}>
            <DialogContent className="bg-slate-900 border-slate-800 text-slate-100 max-w-lg">
                <DialogHeader>
                    <DialogTitle className="text-xl font-bold text-amber-500">
                        {t("הוסף רישיון חדש", "Add New License")}
                    </DialogTitle>
                </DialogHeader>
                <form onSubmit={handleSubmit} className="space-y-4 py-2">
                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">{t("שם חברה", "Company Name")} *</label>
                        <Input 
                            required 
                            className="bg-slate-950 border-slate-800" 
                            value={formData.company} 
                            onChange={e => setFormData({ ...formData, company: e.target.value })} 
                        />
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">{t("קו רוחב", "Latitude")} *</label>
                            <Input 
                                required type="number" step="any" 
                                className="bg-slate-950 border-slate-800"
                                value={formData.lat} 
                                onChange={e => setFormData({ ...formData, lat: e.target.value })} 
                            />
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">{t("קו אורך", "Longitude")} *</label>
                            <Input 
                                required type="number" step="any" 
                                className="bg-slate-950 border-slate-800"
                                value={formData.lng} 
                                onChange={e => setFormData({ ...formData, lng: e.target.value })} 
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">{t("מדינה", "Country")} *</label>
                            <Select 
                                value={formData.country} 
                                onValueChange={val => setFormData({ ...formData, country: val })}
                            >
                                <SelectTrigger className="bg-slate-950 border-slate-800">
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent className="bg-slate-900 border-slate-800 max-h-[200px]">
                                    {countriesList.map(c => (
                                        <SelectItem key={c} value={c}>{c}</SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                        <div className="space-y-2">
                            <label className="text-xs font-bold text-slate-500 uppercase">{t("אזור", "Region")}</label>
                            <Input 
                                className="bg-slate-950 border-slate-800"
                                value={formData.region} 
                                onChange={e => setFormData({ ...formData, region: e.target.value })} 
                            />
                        </div>
                    </div>

                    <div className="space-y-2">
                        <label className="text-xs font-bold text-slate-500 uppercase">{t("סחורה", "Commodity")}</label>
                        <Input 
                            className="bg-slate-950 border-slate-800"
                            value={formData.commodity} 
                            onChange={e => setFormData({ ...formData, commodity: e.target.value })} 
                        />
                    </div>

                    <DialogFooter className="pt-4">
                        <Button type="button" variant="ghost" onClick={onClose} className="text-slate-400 hover:text-slate-100">
                            {t("ביטול", "Cancel")}
                        </Button>
                        <Button type="submit" className="bg-amber-500 hover:bg-amber-600 text-slate-950 font-bold px-8">
                            {t("צור רישיון", "Create License")}
                        </Button>
                    </DialogFooter>
                </form>
            </DialogContent>
        </Dialog>
    );
}
