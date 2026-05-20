CREATE INDEX IF NOT EXISTS oil_terminals_geom_idx ON oil_terminals USING GIST (geom);
CREATE INDEX IF NOT EXISTS oil_ais_positions_geom_idx ON oil_ais_positions USING GIST (geom);
CREATE INDEX IF NOT EXISTS oil_ais_positions_mmsi_ts_idx ON oil_ais_positions (mmsi, ts DESC);
CREATE INDEX IF NOT EXISTS oil_port_calls_status_idx ON oil_port_calls (status);
CREATE INDEX IF NOT EXISTS oil_port_calls_terminal_idx ON oil_port_calls (terminal_id);
CREATE INDEX IF NOT EXISTS oil_companies_type_idx ON oil_companies (company_type);
CREATE INDEX IF NOT EXISTS oil_intelligence_created_idx ON oil_intelligence_cards (created_at DESC);
