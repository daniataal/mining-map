-- Migration 025: Commercial Gates
-- Purpose: Create strict boundaries between public intelligence and real-world deal execution.
-- These tables must be accessed via protected APIs requiring the 'trade_execution' scope.

CREATE TABLE IF NOT EXISTS trade_kyc_profiles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    organization_id UUID REFERENCES core_organizations(id) ON DELETE CASCADE,
    kyc_status TEXT NOT NULL DEFAULT 'pending', -- pending, verified, rejected
    verification_level TEXT, -- e.g., 'standard', 'enhanced'
    sanctions_screened BOOLEAN DEFAULT FALSE,
    last_screened_at TIMESTAMPTZ,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_deal_rooms (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    creator_org_id UUID REFERENCES core_organizations(id) ON DELETE CASCADE,
    title TEXT NOT NULL,
    commodity_family TEXT NOT NULL, -- e.g., 'oil_gas'
    status TEXT NOT NULL DEFAULT 'open', -- open, negotiating, closed, failed
    visibility TEXT NOT NULL DEFAULT 'private', -- private, network
    terms JSONB DEFAULT '{}'::jsonb, -- Intended cargo details
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS trade_contracts (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    deal_room_id UUID REFERENCES trade_deal_rooms(id) ON DELETE CASCADE,
    seller_org_id UUID REFERENCES core_organizations(id),
    buyer_org_id UUID REFERENCES core_organizations(id),
    status TEXT NOT NULL DEFAULT 'draft', -- draft, signed, executing, fulfilled
    legal_framework TEXT, -- e.g., 'English Law'
    execution_data JSONB DEFAULT '{}'::jsonb, -- e.g., signatures, BOL references
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_trade_kyc_org ON trade_kyc_profiles(organization_id);
CREATE INDEX IF NOT EXISTS idx_trade_deal_creator ON trade_deal_rooms(creator_org_id);
CREATE INDEX IF NOT EXISTS idx_trade_contracts_deal ON trade_contracts(deal_room_id);
