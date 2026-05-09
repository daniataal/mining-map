export type LicenseStatus = 'Operating' | 'APPROVED' | 'PENDING' | 'REJECTED' | 'EXPIRED' | string;

export interface MiningLicense {
  id: string;
  company: string;
  licenseType: string;
  commodity: string;
  status: LicenseStatus;
  date: string | null;
  country: string;
  region: string;
  lat: number;
  lng: number;
  phoneNumber?: string | null;
  contactPerson?: string | null;
  pricePerKg?: number;
  capacity?: number;
  isExported?: boolean;
}

export interface User {
  id: string;
  username: string;
  role: 'admin' | 'user';
  phone_number?: string;
  created_at: string;
}

export interface ActivityLog {
  id: string;
  user_id: string;
  username: string;
  action: string;
  details?: string;
  timestamp: string;
}

export interface UserAnnotation {
  status?: LicenseStatus;
  stage?: string;
  comment?: string;
  notes?: string;
  commodity?: string;
  licenseType?: string;
  price?: number;
  quantity?: number;
  contactPerson?: string;
  phoneNumber?: string;
  [key: string]: any;
}

export interface MeetingPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
  address?: string;
  status: 'ACTIVE' | 'INACTIVE';
}

export interface MinerListing {
  id: string;
  miner_id: string;
  product: string;
  shape: string;
  quantity: number;
  price_per_kg: number;
  lat: number;
  lng: number;
  photo_url?: string;
  meeting_point_id?: string;
  meeting_date?: string;
  status: 'PENDING' | 'CONTACTED' | 'MEETING' | 'ASSAY' | 'OFFER' | 'ACCEPTED' | 'REJECTED' | 'PURCHASED' | 'TRANSFERRED';
}

