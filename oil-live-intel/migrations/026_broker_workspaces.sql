-- Migration 026: Broker Workspaces
-- Purpose: Create isolated sandbox environments for brokers to mix public intelligence with private deal networks.

CREATE TABLE IF NOT EXISTS user_workspaces (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_nodes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES user_workspaces(id) ON DELETE CASCADE,
    node_type TEXT NOT NULL, -- e.g., 'public_asset', 'public_org', 'private_entity'
    ref_id TEXT, -- References core_assets.id, core_organizations.id, or oil_vessels.imo if public
    private_data JSONB DEFAULT '{}'::jsonb, -- Custom name, properties if private
    canvas_x NUMERIC,
    canvas_y NUMERIC,
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS workspace_edges (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    workspace_id UUID REFERENCES user_workspaces(id) ON DELETE CASCADE,
    source_node_id UUID REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    target_node_id UUID REFERENCES workspace_nodes(id) ON DELETE CASCADE,
    label TEXT, -- e.g., 'Supplier', 'Buyer', 'Operator'
    created_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_user_workspaces_user ON user_workspaces(user_id);
CREATE INDEX IF NOT EXISTS idx_workspace_nodes_ws ON workspace_nodes(workspace_id);
CREATE INDEX IF NOT EXISTS idx_workspace_edges_ws ON workspace_edges(workspace_id);
